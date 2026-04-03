import { requirePermission } from '../../lib/auth.js';
import { insertAuditLog } from '../../lib/audit.js';
import { queryOne, withTransaction } from '../../lib/db.js';
import { readJsonBody, sendMethodNotAllowed } from '../../lib/http.js';

type IssueSeverity = 'critical' | 'warning' | 'info';

type SystemIssue = {
  id: string;
  severity: IssueSeverity;
  title: string;
  summary: string;
  fix: string;
  route?: string;
  file?: string;
};

type ComponentCatalogEntry = {
  id: string;
  label: string;
  route: string;
  permission: string;
  file: string;
  functionality: string;
};

type HistoryScopeId =
  | 'sales'
  | 'cash-shifts'
  | 'inventory'
  | 'expenses'
  | 'audit'
  | 'purchase-orders'
  | 'label-history'
  | 'all';

const COMPONENT_CATALOG: ComponentCatalogEntry[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    route: '/',
    permission: 'dashboard',
    file: 'src/components/Dashboard.tsx',
    functionality: 'Shows daily KPIs, recent transactions, receipt preview and system status access.'
  },
  {
    id: 'pos',
    label: 'Sale',
    route: '/pos',
    permission: 'pos',
    file: 'src/components/POS.tsx',
    functionality: 'Scanner-first checkout, customer capture, credit detection, receipts and till activity.'
  },
  {
    id: 'sales-history',
    label: 'Sales History',
    route: '/sales-history',
    permission: 'sales-history',
    file: 'src/components/SalesHistory.tsx',
    functionality: 'Reviews completed sales, line items, partial refunds, full refunds and refund receipts.'
  },
  {
    id: 'shifts',
    label: 'Cash Shifts',
    route: '/cash-shifts',
    permission: 'shifts',
    file: 'src/components/CashShifts.tsx',
    functionality: 'Opens tills, records cash movements, reconciles counted cash and prints shift reports.'
  },
  {
    id: 'customers',
    label: 'Customers',
    route: '/customers',
    permission: 'customers',
    file: 'src/components/Customers.tsx',
    functionality: 'Maintains customer identities, balances, contact details and loyalty-linked records.'
  },
  {
    id: 'credits',
    label: 'Credits',
    route: '/credits',
    permission: 'credits',
    file: 'src/components/Credits.tsx',
    functionality: 'Tracks open credit sales, outstanding balances, settlements and payment receipts.'
  },
  {
    id: 'products',
    label: 'Products',
    route: '/products',
    permission: 'products',
    file: 'src/components/Products.tsx',
    functionality: 'Creates, edits and archives products with pricing, stock thresholds, suppliers and labels.'
  },
  {
    id: 'categories',
    label: 'Categories',
    route: '/categories',
    permission: 'categories',
    file: 'src/components/Categories.tsx',
    functionality: 'Groups products into sellable catalog categories.'
  },
  {
    id: 'inventory',
    label: 'Inventory',
    route: '/inventory',
    permission: 'inventory',
    file: 'src/components/Inventory.tsx',
    functionality: 'Receives stock, adjusts quantities and reviews stock levels plus inventory movement history.'
  },
  {
    id: 'purchase-orders',
    label: 'Purchase Orders',
    route: '/purchase-orders',
    permission: 'purchase-orders',
    file: 'src/components/PurchaseOrders.tsx',
    functionality: 'Creates supplier purchase orders and records goods receiving into inventory.'
  },
  {
    id: 'suppliers',
    label: 'Suppliers',
    route: '/suppliers',
    permission: 'suppliers',
    file: 'src/components/Suppliers.tsx',
    functionality: 'Maintains supplier directory details used by products and procurement.'
  },
  {
    id: 'branches',
    label: 'Branches',
    route: '/branches',
    permission: 'branches',
    file: 'src/components/Branches.tsx',
    functionality: 'Manages store locations, receipt branch identity and branch assignment defaults.'
  },
  {
    id: 'labels',
    label: 'Labels',
    route: '/labels',
    permission: 'labels',
    file: 'src/components/Labels.tsx',
    functionality: 'Designs barcode labels, templates and print history for product labels.'
  },
  {
    id: 'users',
    label: 'Users',
    route: '/users',
    permission: 'users',
    file: 'src/components/Users.tsx',
    functionality: 'Creates staff accounts, assigns branches, roles and permission presets.'
  },
  {
    id: 'audit-logs',
    label: 'Audit Logs',
    route: '/audit-logs',
    permission: 'audit-logs',
    file: 'src/components/AuditLogs.tsx',
    functionality: 'Reviews administrative and operational events for accountability and investigation.'
  },
  {
    id: 'expenses',
    label: 'Expenses',
    route: '/expenses',
    permission: 'expenses',
    file: 'src/components/Expenses.tsx',
    functionality: 'Records expense vouchers, manages expense categories and prints expense receipts.'
  },
  {
    id: 'reports',
    label: 'Reports',
    route: '/reports',
    permission: 'reports',
    file: 'src/components/Reports.tsx',
    functionality: 'Exports sales, profit, inventory and product movement reports for chosen periods.'
  },
  {
    id: 'settings',
    label: 'Settings',
    route: '/settings',
    permission: 'settings',
    file: 'src/components/Settings.tsx',
    functionality: 'Controls security, store profile, receipt appearance, scanner, drawer and cleanup tools.'
  },
  {
    id: 'status',
    label: 'System Status',
    route: '/status',
    permission: 'status',
    file: 'src/components/ReadinessPanel.tsx',
    functionality: 'Shows live system health, operational issues, counts, fix guidance and component reference.'
  }
];

const HISTORY_SCOPES: Array<{
  id: Exclude<HistoryScopeId, 'all'>;
  label: string;
  description: string;
  warning: string;
}> = [
  {
    id: 'sales',
    label: 'Sales & Credit History',
    description: 'Deletes sales, sale items, linked credits and linked credit payments.',
    warning: 'Keeps current stock quantities untouched, but rebuilds customer credit balances from remaining open credits.'
  },
  {
    id: 'cash-shifts',
    label: 'Cash Shift History',
    description: 'Deletes historical cash shifts and their linked cash movement records.',
    warning: 'Use this only after exporting or printing the shift reports you need.'
  },
  {
    id: 'inventory',
    label: 'Inventory Movement History',
    description: 'Deletes inventory ledger movement history only.',
    warning: 'Current product stock quantities are preserved; only the movement trail is removed.'
  },
  {
    id: 'expenses',
    label: 'Expense History',
    description: 'Deletes expense documents and their printable voucher history.',
    warning: 'Expense categories stay intact; only recorded expense transactions are removed.'
  },
  {
    id: 'audit',
    label: 'Audit Log History',
    description: 'Deletes audit trail rows.',
    warning: 'A fresh audit entry will be written for the cleanup action itself.'
  },
  {
    id: 'purchase-orders',
    label: 'Purchase Order History',
    description: 'Deletes purchase order documents stored in the document collection.',
    warning: 'Received stock stays in inventory; only the purchase order history is removed.'
  },
  {
    id: 'label-history',
    label: 'Label Print History',
    description: 'Deletes label print history records.',
    warning: 'Label templates remain available; only the print activity log is removed.'
  }
];

async function countTable(table: string) {
  const row = await queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
  return Number(row?.count ?? '0');
}

async function countDocuments(collectionName: string) {
  const row = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM app_documents WHERE collection_name = $1',
    [collectionName]
  );
  return Number(row?.count ?? '0');
}

async function rebuildCustomerBalances(client: any) {
  await client.query(
    `
    UPDATE customers AS c
    SET
      total_balance = COALESCE(open_credits.total_balance, 0),
      updated_at = NOW()
    FROM (
      SELECT customer_id, SUM(outstanding_balance)::numeric AS total_balance
      FROM credits
      WHERE status = 'open' AND customer_id IS NOT NULL
      GROUP BY customer_id
    ) AS open_credits
    WHERE c.id = open_credits.customer_id
    `
  );

  await client.query(
    `
    UPDATE customers
    SET total_balance = 0, updated_at = NOW()
    WHERE id NOT IN (
      SELECT customer_id
      FROM credits
      WHERE status = 'open' AND customer_id IS NOT NULL
    )
    AND total_balance <> 0
    `
  );
}

async function buildSystemStatusReport() {
  const [
    userCount,
    activeUserCount,
    branchCount,
    productCount,
    customerCount,
    salesCount,
    creditsCount,
    creditPaymentCount,
    inventoryCount,
    auditCount,
    cashShiftCount,
    openCashShiftCount,
    categoriesCount,
    suppliersCount,
    expenseCount,
    expenseCategoryCount,
    purchaseOrderCount,
    labelTemplateCount,
    labelHistoryCount,
    settingsRow,
    adminCoverageRow
  ] = await Promise.all([
    countTable('users'),
    queryOne<{ count: string }>("SELECT COUNT(*)::text AS count FROM users WHERE status = 'active'"),
    countTable('branches'),
    countTable('products'),
    countTable('customers'),
    countTable('sales'),
    countTable('credits'),
    countTable('credit_payments'),
    countTable('inventory_ledger'),
    countTable('audit_logs'),
    countTable('cash_shifts'),
    queryOne<{ count: string }>("SELECT COUNT(*)::text AS count FROM cash_shifts WHERE status = 'open'"),
    countDocuments('categories'),
    countDocuments('suppliers'),
    countDocuments('expenses'),
    countDocuments('expense_categories'),
    countDocuments('purchase_orders'),
    countDocuments('label_templates'),
    countDocuments('label_history'),
    queryOne<{
      business_name: string | null;
      default_branch_id: string | null;
      receipt_header: string | null;
      receipt_footer: string | null;
      drawer_enabled: boolean | null;
      drawer_helper_url: string | null;
      receipt_brand_color: string | null;
      receipt_paper_width_mm: string | number | null;
      receipt_font_size_px: string | number | null;
    }>('SELECT * FROM system_settings WHERE id = $1 LIMIT 1', ['system']),
    queryOne<{ admin_count: string; superadmin_count: string }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE role = 'admin' AND status = 'active')::text AS admin_count,
        COUNT(*) FILTER (WHERE role = 'superadmin' AND status = 'active')::text AS superadmin_count
      FROM users
      `
    )
  ]);

  const counts = {
    users: userCount,
    activeUsers: Number(activeUserCount?.count ?? '0'),
    branches: branchCount,
    products: productCount,
    customers: customerCount,
    sales: salesCount,
    credits: creditsCount,
    creditPayments: creditPaymentCount,
    inventoryTransactions: inventoryCount,
    auditLogs: auditCount,
    cashShifts: cashShiftCount,
    openCashShifts: Number(openCashShiftCount?.count ?? '0'),
    categories: categoriesCount,
    suppliers: suppliersCount,
    expenses: expenseCount,
    expenseCategories: expenseCategoryCount,
    purchaseOrders: purchaseOrderCount,
    labelTemplates: labelTemplateCount,
    labelHistory: labelHistoryCount
  };

  const issues: SystemIssue[] = [];

  if (counts.branches === 0) {
    issues.push({
      id: 'no-branches',
      severity: 'critical',
      title: 'No branches configured',
      summary: 'Receipts, user assignment and branch-level reporting need at least one active branch.',
      fix: 'Create a branch in the Branches page, then set it as default in Settings.',
      route: '/branches',
      file: 'src/components/Branches.tsx'
    });
  }

  if (counts.products === 0) {
    issues.push({
      id: 'no-products',
      severity: 'critical',
      title: 'No products available for sale',
      summary: 'The POS screen cannot sell items until products exist.',
      fix: 'Add products with price, stock and barcode/SKU in the Products page.',
      route: '/products',
      file: 'src/components/Products.tsx'
    });
  }

  if (counts.categories === 0) {
    issues.push({
      id: 'no-categories',
      severity: 'warning',
      title: 'No product categories found',
      summary: 'Products can still exist, but catalog organization and reporting will be weaker.',
      fix: 'Create at least one category from the Categories page and link products to it.',
      route: '/categories',
      file: 'src/components/Categories.tsx'
    });
  }

  if (counts.suppliers === 0) {
    issues.push({
      id: 'no-suppliers',
      severity: 'warning',
      title: 'No suppliers configured',
      summary: 'Receiving, procurement and supplier-based cost tracking work better with supplier records.',
      fix: 'Create suppliers in the Suppliers page before raising purchase orders or receiving stock.',
      route: '/suppliers',
      file: 'src/components/Suppliers.tsx'
    });
  }

  if (!settingsRow?.business_name?.trim()) {
    issues.push({
      id: 'missing-business-name',
      severity: 'warning',
      title: 'Receipt identity is incomplete',
      summary: 'Business name is missing from system settings, which weakens receipt branding.',
      fix: 'Set business identity and receipt appearance in Settings.',
      route: '/settings',
      file: 'src/components/Settings.tsx'
    });
  }

  if (!settingsRow?.default_branch_id?.trim()) {
    issues.push({
      id: 'missing-default-branch',
      severity: 'warning',
      title: 'Default branch is not configured',
      summary: 'Fallback branch selection is missing for receipts and branch-aware operations.',
      fix: 'Choose a default branch inside Settings.',
      route: '/settings',
      file: 'src/components/Settings.tsx'
    });
  }

  if (settingsRow?.drawer_enabled && !settingsRow?.drawer_helper_url?.trim()) {
    issues.push({
      id: 'drawer-helper-missing',
      severity: 'warning',
      title: 'Cash drawer helper URL is missing',
      summary: 'Drawer integration is enabled, but no local helper URL is configured.',
      fix: 'Set the local drawer helper URL in Settings or disable drawer integration.',
      route: '/settings',
      file: 'src/components/Settings.tsx'
    });
  }

  if (Number(adminCoverageRow?.superadmin_count ?? '0') === 0) {
    issues.push({
      id: 'no-superadmin',
      severity: 'critical',
      title: 'No active superadmin account found',
      summary: 'Recovery and full-system administration require at least one active superadmin.',
      fix: 'Restore or create a superadmin account from admin tooling or database recovery.',
      route: '/users',
      file: 'src/components/Users.tsx'
    });
  }

  if (counts.expenseCategories === 0) {
    issues.push({
      id: 'no-expense-categories',
      severity: 'info',
      title: 'No expense categories configured',
      summary: 'Expense entry still works, but reporting is clearer with proper categories.',
      fix: 'Create expense categories from the Expenses page.',
      route: '/expenses',
      file: 'src/components/Expenses.tsx'
    });
  }

  if (counts.sales === 0) {
    issues.push({
      id: 'no-sales-history',
      severity: 'info',
      title: 'No sales history recorded yet',
      summary: 'Sales dashboards, history and profit reporting will stay empty until trading begins.',
      fix: 'Complete a sale from the Sale page to start building operational history.',
      route: '/pos',
      file: 'src/components/POS.tsx'
    });
  }

  const services = [
    {
      id: 'database',
      label: 'Database',
      status: 'ok' as const,
      message: 'Postgres schema and document bridge are reachable.'
    },
    {
      id: 'auth',
      label: 'Authentication',
      status: counts.activeUsers > 0 ? ('ok' as const) : ('warning' as const),
      message:
        counts.activeUsers > 0
          ? `${counts.activeUsers} active user account(s) available for sign-in.`
          : 'No active users detected.'
    },
    {
      id: 'receipts',
      label: 'Receipt Configuration',
      status: settingsRow?.business_name?.trim() ? ('ok' as const) : ('warning' as const),
      message: settingsRow?.business_name?.trim()
        ? `Configured at ${Number(settingsRow?.receipt_paper_width_mm ?? 80)}mm width and ${Number(settingsRow?.receipt_font_size_px ?? 12)}px base font.`
        : 'Receipt branding still needs business identity setup.'
    },
    {
      id: 'cash-drawer',
      label: 'Cash Drawer',
      status: settingsRow?.drawer_enabled ? ('warning' as const) : ('ok' as const),
      message: settingsRow?.drawer_enabled
        ? `Drawer helper enabled at ${settingsRow.drawer_helper_url || 'no URL set'}.`
        : 'Drawer helper is disabled.'
    }
  ];

  return {
    generatedAt: new Date().toISOString(),
    services,
    counts,
    issues,
    components: COMPONENT_CATALOG,
    historyScopes: await Promise.all(
      HISTORY_SCOPES.map(async (scope) => {
        const recordCount =
          scope.id === 'sales'
            ? counts.sales
            : scope.id === 'cash-shifts'
              ? counts.cashShifts
              : scope.id === 'inventory'
                ? counts.inventoryTransactions
                : scope.id === 'expenses'
                  ? counts.expenses
                  : scope.id === 'audit'
                    ? counts.auditLogs
                    : scope.id === 'purchase-orders'
                      ? counts.purchaseOrders
                      : counts.labelHistory;

        return {
          ...scope,
          recordCount
        };
      })
    ),
    receiptAppearance: {
      brandColor: settingsRow?.receipt_brand_color || '#4f46e5',
      paperWidthMm: Number(settingsRow?.receipt_paper_width_mm ?? 80),
      fontSizePx: Number(settingsRow?.receipt_font_size_px ?? 12),
      header: settingsRow?.receipt_header || 'Thank you for shopping with us!',
      footer: settingsRow?.receipt_footer || 'Goods once sold are not returnable.'
    }
  };
}

async function purgeHistoryScope(scope: HistoryScopeId, user: Awaited<ReturnType<typeof requirePermission>>) {
  if (!user) {
    throw new Error('Permission denied');
  }

  return withTransaction(async (client) => {
    const deleted: Record<string, number> = {};

    const deleteTable = async (table: string, key: string, whereClause = '', params: unknown[] = []) => {
      const countRow = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${table}${whereClause ? ` WHERE ${whereClause}` : ''}`,
        params
      );
      deleted[key] = Number(countRow.rows[0]?.count ?? '0');
      await client.query(`DELETE FROM ${table}${whereClause ? ` WHERE ${whereClause}` : ''}`, params);
    };

    const deleteDocuments = async (collectionName: string, key: string) => {
      const countRow = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM app_documents WHERE collection_name = $1',
        [collectionName]
      );
      deleted[key] = Number(countRow.rows[0]?.count ?? '0');
      await client.query('DELETE FROM app_documents WHERE collection_name = $1', [collectionName]);
    };

    const scopes = scope === 'all' ? HISTORY_SCOPES.map((entry) => entry.id) : [scope];

    for (const currentScope of scopes) {
      if (currentScope === 'sales') {
        await deleteTable('sales', 'sales');
        await rebuildCustomerBalances(client);
      } else if (currentScope === 'cash-shifts') {
        await deleteTable('cash_shifts', 'cashShifts');
      } else if (currentScope === 'inventory') {
        await deleteTable('inventory_ledger', 'inventoryTransactions');
      } else if (currentScope === 'expenses') {
        await deleteDocuments('expenses', 'expenses');
      } else if (currentScope === 'audit') {
        await deleteTable('audit_logs', 'auditLogs');
      } else if (currentScope === 'purchase-orders') {
        await deleteDocuments('purchase_orders', 'purchaseOrders');
      } else if (currentScope === 'label-history') {
        await deleteDocuments('label_history', 'labelHistory');
      }
    }

    await insertAuditLog(
      client,
      user,
      'PURGE_HISTORY',
      `Purged history scope: ${scope}. Counts: ${JSON.stringify(deleted)}`
    );

    return {
      ok: true,
      scope,
      deleted
    };
  });
}

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    try {
      const user = await requirePermission(req, res, ['settings', 'status']);
      if (!user) {
        return;
      }

      return res.status(200).json(await buildSystemStatusReport());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown server error';
      return res.status(500).json({ error: message });
    }
  }

  if (req.method === 'POST') {
    try {
      const user = await requirePermission(req, res, ['settings']);
      if (!user) {
        return;
      }

      const body = await readJsonBody<{ scope?: HistoryScopeId }>(req);
      const scope = body.scope;
      if (!scope || !['sales', 'cash-shifts', 'inventory', 'expenses', 'audit', 'purchase-orders', 'label-history', 'all'].includes(scope)) {
        return res.status(400).json({ error: 'A valid cleanup scope is required' });
      }

      return res.status(200).json(await purgeHistoryScope(scope, user));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown server error';
      return res.status(500).json({ error: message });
    }
  }

  return sendMethodNotAllowed(res, ['GET', 'POST']);
}
