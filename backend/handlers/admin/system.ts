import { requirePermission } from '../../lib/auth.js';
import { insertAuditLog } from '../../lib/audit.js';
import { queryOne, queryRows, withTransaction } from '../../lib/db.js';
import { readJsonBody, sendMethodNotAllowed } from '../../lib/http.js';

type IssueSeverity = 'critical' | 'warning' | 'info';

type SystemIssue = {
  id: string;
  severity: IssueSeverity;
  title: string;
  summary: string;
  fix: string;
  componentId?: string;
  route?: string;
  file?: string;
};

type ModuleHealthStatus = 'ok' | 'warning' | 'error';

type ModuleHealthEntry = ComponentCatalogEntry & {
  status: ModuleHealthStatus;
  summary: string;
  fix?: string;
  issueCount: number;
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

type DeletableReceiptKind = 'sale' | 'refund' | 'credit-payment' | 'expense' | 'cash-shift';

type ReceiptSearchKind = 'all' | DeletableReceiptKind;

type ReceiptSearchResult = {
  id: string;
  kind: DeletableReceiptKind;
  label: string;
  receiptNumber: string;
  issuedAt: string;
  branchName: string | null;
  actorName: string;
  subjectName: string | null;
  reference: string | null;
  amount: number;
  status: string;
  summary: string;
  warning: string;
};

type ReceiptSearchFilters = {
  kind: ReceiptSearchKind;
  query: string;
  dateFrom: string | null;
  dateTo: string | null;
  limit: number;
};

type ReceiptDeleteResult = {
  ok: true;
  kind: DeletableReceiptKind;
  id: string;
  deleted: Record<string, number>;
  message: string;
};

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

const RECEIPT_KIND_OPTIONS: DeletableReceiptKind[] = ['sale', 'refund', 'credit-payment', 'expense', 'cash-shift'];

function isValidHexColor(value: string | null | undefined) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test((value || '').trim());
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function toIsoString(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function parseReceiptSearchFilters(req: any): ReceiptSearchFilters {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const searchParams = requestUrl.searchParams;
  const kindParam = (searchParams.get('kind') || 'all').trim() as ReceiptSearchKind;
  const limitParam = Number(searchParams.get('limit') ?? '50');

  return {
    kind: kindParam === 'all' || RECEIPT_KIND_OPTIONS.includes(kindParam) ? kindParam : 'all',
    query: (searchParams.get('query') || '').trim(),
    dateFrom: toIsoString(searchParams.get('dateFrom')),
    dateTo: toIsoString(searchParams.get('dateTo')),
    limit: Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50
  };
}

function buildReceiptWhereClause(
  filters: ReceiptSearchFilters,
  issuedAtExpression: string,
  searchableExpressions: string[],
  extraConditions: string[] = []
) {
  const params: unknown[] = [];
  const conditions = [...extraConditions];

  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`${issuedAtExpression} >= $${params.length}::timestamptz`);
  }

  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`${issuedAtExpression} <= $${params.length}::timestamptz`);
  }

  if (filters.query) {
    params.push(`%${escapeLike(filters.query.toLowerCase())}%`);
    const queryParamIndex = params.length;
    conditions.push(
      `(${searchableExpressions
        .map((expression) => `LOWER(COALESCE(${expression}, '')) LIKE $${queryParamIndex} ESCAPE '\\'`)
        .join(' OR ')})`
    );
  }

  return {
    params,
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  };
}

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

async function searchReceipts(filters: ReceiptSearchFilters) {
  const saleFilters =
    filters.kind === 'sale'
      ? ['COALESCE(s.refund_amount, 0) = 0', 's.is_refunded = FALSE']
      : filters.kind === 'refund'
        ? ['(COALESCE(s.refund_amount, 0) > 0 OR s.is_refunded = TRUE)']
        : [];
  const saleWhere = buildReceiptWhereClause(filters, 's.sold_at', ['s.id', 's.customer_name', 's.cashier_name', 's.reference', 'b.name'], saleFilters);
  const salesPromise =
    filters.kind === 'all' || filters.kind === 'sale' || filters.kind === 'refund'
      ? queryRows<{
          id: string;
          sold_at: string;
          branch_name: string | null;
          cashier_name: string;
          customer_name: string | null;
          reference: string | null;
          total_amount: string;
          refund_amount: string;
          is_refunded: boolean;
          payment_method: string;
          tender_method: string | null;
          refund_reason: string | null;
          outstanding_balance: string;
        }>(
          `
          SELECT
            s.id,
            s.sold_at,
            b.name AS branch_name,
            s.cashier_name,
            s.customer_name,
            s.reference,
            s.total_amount::text,
            s.refund_amount::text,
            s.is_refunded,
            s.payment_method,
            s.tender_method,
            s.refund_reason,
            s.outstanding_balance::text
          FROM sales s
          LEFT JOIN branches b ON b.id = s.branch_id
          ${saleWhere.clause}
          ORDER BY s.sold_at DESC
          LIMIT $${saleWhere.params.length + 1}
          `,
          [...saleWhere.params, filters.limit]
        )
      : Promise.resolve([]);

  const creditPaymentWhere = buildReceiptWhereClause(
    filters,
    'cp.paid_at',
    ['cp.id', 'cp.sale_id', 'cr.customer_name', 'cp.cashier_name', 'cp.reference', 'b.name'],
    []
  );
  const creditPaymentsPromise =
    filters.kind === 'all' || filters.kind === 'credit-payment'
      ? queryRows<{
          id: string;
          paid_at: string;
          branch_name: string | null;
          cashier_name: string;
          customer_name: string | null;
          reference: string | null;
          amount_paid: string;
          remaining_balance: string;
          payment_method: string;
        }>(
          `
          SELECT
            cp.id,
            cp.paid_at,
            b.name AS branch_name,
            cp.cashier_name,
            cr.customer_name,
            cp.reference,
            cp.amount_paid::text,
            cp.remaining_balance::text,
            cp.payment_method
          FROM credit_payments cp
          INNER JOIN credits cr ON cr.id = cp.credit_id
          LEFT JOIN branches b ON b.id = cp.branch_id
          ${creditPaymentWhere.clause}
          ORDER BY cp.paid_at DESC
          LIMIT $${creditPaymentWhere.params.length + 1}
          `,
          [...creditPaymentWhere.params, filters.limit]
        )
      : Promise.resolve([]);

  const expenseWhere = buildReceiptWhereClause(
    filters,
    `COALESCE(NULLIF(d.payload->>'date', '')::timestamptz, d.created_at)`,
    [`d.id`, `d.payload->>'description'`, `d.payload->>'category'`, `d.payload->>'reference'`, `d.payload->>'recordedByName'`, `b.name`],
    [`d.collection_name = 'expenses'`]
  );
  const expensesPromise =
    filters.kind === 'all' || filters.kind === 'expense'
      ? queryRows<{
          id: string;
          issued_at: string;
          branch_name: string | null;
          actor_name: string | null;
          description: string | null;
          category: string | null;
          reference: string | null;
          amount: string | null;
          payment_method: string | null;
        }>(
          `
          SELECT
            d.id,
            COALESCE(NULLIF(d.payload->>'date', '')::timestamptz, d.created_at)::text AS issued_at,
            b.name AS branch_name,
            d.payload->>'recordedByName' AS actor_name,
            d.payload->>'description' AS description,
            d.payload->>'category' AS category,
            d.payload->>'reference' AS reference,
            NULLIF(d.payload->>'amount', '') AS amount,
            d.payload->>'paymentMethod' AS payment_method
          FROM app_documents d
          LEFT JOIN branches b ON b.id = d.payload->>'branchId'
          ${expenseWhere.clause}
          ORDER BY COALESCE(NULLIF(d.payload->>'date', '')::timestamptz, d.created_at) DESC
          LIMIT $${expenseWhere.params.length + 1}
          `,
          [...expenseWhere.params, filters.limit]
        )
      : Promise.resolve([]);

  const shiftWhere = buildReceiptWhereClause(
    filters,
    's.closed_at',
    ['s.id', 's.user_name', 's.notes', 's.opening_reference', 'b.name'],
    ["s.status = 'closed'"]
  );
  const cashShiftsPromise =
    filters.kind === 'all' || filters.kind === 'cash-shift'
      ? queryRows<{
          id: string;
          closed_at: string;
          branch_name: string | null;
          user_name: string;
          notes: string | null;
          opening_reference: string | null;
          expected_cash: string;
          variance: string;
        }>(
          `
          SELECT
            s.id,
            s.closed_at::text,
            b.name AS branch_name,
            s.user_name,
            s.notes,
            s.opening_reference,
            s.expected_cash::text,
            s.variance::text
          FROM cash_shifts s
          LEFT JOIN branches b ON b.id = s.branch_id
          ${shiftWhere.clause}
          ORDER BY s.closed_at DESC
          LIMIT $${shiftWhere.params.length + 1}
          `,
          [...shiftWhere.params, filters.limit]
        )
      : Promise.resolve([]);

  const [sales, creditPayments, expenses, cashShifts] = await Promise.all([
    salesPromise,
    creditPaymentsPromise,
    expensesPromise,
    cashShiftsPromise
  ]);

  const receipts: ReceiptSearchResult[] = [
    ...sales.map((sale) => {
      const isRefundReceipt = Number(sale.refund_amount ?? '0') > 0 || sale.is_refunded;
      const amount = isRefundReceipt ? Number(sale.refund_amount ?? '0') || Number(sale.total_amount ?? '0') : Number(sale.total_amount ?? '0');
      return {
        id: sale.id,
        kind: isRefundReceipt ? 'refund' : 'sale',
        label: isRefundReceipt ? 'Refund Receipt' : 'Sale Receipt',
        receiptNumber: sale.id,
        issuedAt: sale.sold_at,
        branchName: sale.branch_name,
        actorName: sale.cashier_name,
        subjectName: sale.customer_name || 'Walk-in customer',
        reference: sale.reference,
        amount,
        status: Number(sale.outstanding_balance ?? '0') > 0 ? 'Open credit linked' : 'Completed',
        summary: isRefundReceipt
          ? sale.refund_reason || 'Refunded sale receipt'
          : `${(sale.tender_method || sale.payment_method || 'sale').toUpperCase()} tender`,
        warning:
          'Deletes the sale record, sale items, linked credits, linked credit payments, sale/refund stock ledger entries, and refund cash movement history. Current stock quantities are not recalculated.'
      } satisfies ReceiptSearchResult;
    }),
    ...creditPayments.map((payment) => ({
      id: payment.id,
      kind: 'credit-payment' as const,
      label: 'Credit Payment Receipt',
      receiptNumber: payment.id,
      issuedAt: payment.paid_at,
      branchName: payment.branch_name,
      actorName: payment.cashier_name,
      subjectName: payment.customer_name || 'Customer',
      reference: payment.reference,
      amount: Number(payment.amount_paid ?? '0'),
      status: Number(payment.remaining_balance ?? '0') > 0 ? 'Partially settled' : 'Fully settled',
      summary: `Remaining balance KES ${Number(payment.remaining_balance ?? '0').toLocaleString()}`,
      warning:
        'Deletes the payment receipt and restores the same amount back to the linked credit and sale outstanding balances.'
    })),
    ...expenses.map((expense) => ({
      id: expense.id,
      kind: 'expense' as const,
      label: 'Expense Voucher',
      receiptNumber: expense.id,
      issuedAt: expense.issued_at,
      branchName: expense.branch_name,
      actorName: expense.actor_name || 'System',
      subjectName: expense.description || 'Expense',
      reference: expense.reference,
      amount: Number(expense.amount ?? '0'),
      status: (expense.payment_method || 'other').toUpperCase(),
      summary: [expense.category, expense.description].filter(Boolean).join(' - '),
      warning:
        'Deletes the expense voucher and removes the matched cash movement row when the voucher came from a cash shift.'
    })),
    ...cashShifts.map((shift) => ({
      id: shift.id,
      kind: 'cash-shift' as const,
      label: 'Cash Shift Report',
      receiptNumber: shift.id,
      issuedAt: shift.closed_at,
      branchName: shift.branch_name,
      actorName: shift.user_name,
      subjectName: shift.notes || 'Cash shift closure',
      reference: shift.opening_reference,
      amount: Number(shift.expected_cash ?? '0'),
      status: Number(shift.variance ?? '0') === 0 ? 'Balanced' : `Variance KES ${Number(shift.variance ?? '0').toLocaleString()}`,
      summary: 'Deletes the closed shift report and all cash movements logged inside that shift.',
      warning:
        'Deletes the closed shift and every movement linked to that shift. Open shifts cannot be deleted from this tool.'
    }))
  ];

  return {
    filters,
    receipts: receipts
      .sort((left, right) => new Date(right.issuedAt).getTime() - new Date(left.issuedAt).getTime())
      .slice(0, filters.limit)
  };
}

async function deleteSingleSaleReceipt(client: any, saleId: string, user: Awaited<ReturnType<typeof requirePermission>>) {
  const sale = await client.query(
    `
    SELECT id, customer_name, customer_id, refund_amount::text, is_refunded
    FROM sales
    WHERE id = $1
    FOR UPDATE
    `,
    [saleId]
  ) as {
    rows: Array<{
      id: string;
      customer_name: string | null;
      customer_id: string | null;
      refund_amount: string;
      is_refunded: boolean;
    }>;
  };

  const saleRow = sale.rows[0];
  if (!saleRow) {
    throw new Error('The selected sale receipt no longer exists');
  }

  const saleItemsCount = await client.query('SELECT COUNT(*)::text AS count FROM sale_items WHERE sale_id = $1', [saleId]) as {
    rows: Array<{ count: string }>;
  };
  const creditCount = await client.query('SELECT COUNT(*)::text AS count FROM credits WHERE sale_id = $1', [saleId]) as {
    rows: Array<{ count: string }>;
  };
  const creditPaymentCount = await client.query(
    'SELECT COUNT(*)::text AS count FROM credit_payments WHERE sale_id = $1',
    [saleId]
  ) as {
    rows: Array<{ count: string }>;
  };
  const inventoryCount = await client.query(
    "SELECT COUNT(*)::text AS count FROM inventory_ledger WHERE source_id = $1 AND source_type IN ('sale', 'refund')",
    [saleId]
  ) as {
    rows: Array<{ count: string }>;
  };
  const refundMovementCount = await client.query(
    "SELECT COUNT(*)::text AS count FROM cash_movements WHERE type = 'refund' AND reason ILIKE $1",
    [`%sale ${saleId}%`]
  ) as {
    rows: Array<{ count: string }>;
  };

  await client.query("DELETE FROM inventory_ledger WHERE source_id = $1 AND source_type IN ('sale', 'refund')", [saleId]);
  await client.query("DELETE FROM cash_movements WHERE type = 'refund' AND reason ILIKE $1", [`%sale ${saleId}%`]);
  await client.query('DELETE FROM sales WHERE id = $1', [saleId]);
  await rebuildCustomerBalances(client);

  const receiptKind = Number(saleRow.refund_amount ?? '0') > 0 || saleRow.is_refunded ? 'refund' : 'sale';
  const deleted = {
    sales: 1,
    saleItems: Number(saleItemsCount.rows[0]?.count ?? '0'),
    credits: Number(creditCount.rows[0]?.count ?? '0'),
    creditPayments: Number(creditPaymentCount.rows[0]?.count ?? '0'),
    inventoryTransactions: Number(inventoryCount.rows[0]?.count ?? '0'),
    cashMovements: Number(refundMovementCount.rows[0]?.count ?? '0')
  };

  await insertAuditLog(
    client,
    user,
    'DELETE_RECEIPT',
    `Deleted ${receiptKind} receipt ${saleId} for ${saleRow.customer_name || 'walk-in customer'}`
  );

  return {
    ok: true,
    kind: receiptKind,
    id: saleId,
    deleted,
    message: `${receiptKind === 'refund' ? 'Refund' : 'Sale'} receipt ${saleId} deleted successfully.`
  } satisfies ReceiptDeleteResult;
}

async function deleteCreditPaymentReceipt(client: any, paymentId: string, user: Awaited<ReturnType<typeof requirePermission>>) {
  const payment = await client.query(
    `
    SELECT
      cp.id,
      cp.credit_id,
      cp.sale_id,
      cp.amount_paid::text,
      cr.customer_name
    FROM credit_payments cp
    INNER JOIN credits cr ON cr.id = cp.credit_id
    INNER JOIN sales s ON s.id = cp.sale_id
    WHERE cp.id = $1
    FOR UPDATE OF cp, cr, s
    `,
    [paymentId]
  ) as {
    rows: Array<{
      id: string;
      credit_id: string;
      sale_id: string;
      amount_paid: string;
      customer_name: string;
    }>;
  };

  const paymentRow = payment.rows[0];
  if (!paymentRow) {
    throw new Error('The selected credit payment receipt no longer exists');
  }

  const amountPaid = Number(paymentRow.amount_paid ?? '0');
  await client.query(
    `
    UPDATE credits
    SET
      amount_paid = GREATEST(amount_paid - $2, 0),
      outstanding_balance = outstanding_balance + $2,
      status = 'open',
      updated_at = NOW()
    WHERE id = $1
    `,
    [paymentRow.credit_id, amountPaid]
  );

  await client.query(
    `
    UPDATE sales
    SET
      amount_paid = GREATEST(amount_paid - $2, 0),
      outstanding_balance = outstanding_balance + $2,
      is_credit = TRUE
    WHERE id = $1
    `,
    [paymentRow.sale_id, amountPaid]
  );

  await client.query('DELETE FROM credit_payments WHERE id = $1', [paymentId]);
  await rebuildCustomerBalances(client);

  await insertAuditLog(
    client,
    user,
    'DELETE_RECEIPT',
    `Deleted credit payment receipt ${paymentId} for ${paymentRow.customer_name}`
  );

  return {
    ok: true,
    kind: 'credit-payment',
    id: paymentId,
    deleted: {
      creditPayments: 1
    },
    message: `Credit payment receipt ${paymentId} deleted and the linked balance was restored.`
  } satisfies ReceiptDeleteResult;
}

async function deleteExpenseReceipt(client: any, expenseId: string, user: Awaited<ReturnType<typeof requirePermission>>) {
  const expense = await client.query(
    `
    SELECT id, payload, created_at::text
    FROM app_documents
    WHERE collection_name = 'expenses' AND id = $1
    FOR UPDATE
    `,
    [expenseId]
  ) as {
    rows: Array<{
      id: string;
      payload: {
        category?: string;
        description?: string;
        amount?: number | string;
        reference?: string | null;
        shiftId?: string | null;
        paymentMethod?: string;
        date?: string;
      };
      created_at: string;
    }>;
  };

  const expenseRow = expense.rows[0];
  if (!expenseRow) {
    throw new Error('The selected expense voucher no longer exists');
  }

  let deletedCashMovements = 0;
  const payload = expenseRow.payload || {};
  if (payload.paymentMethod === 'cash' && payload.shiftId) {
    const reason = `Expense: ${payload.category || 'Expense'} - ${payload.description || 'No description'}`;
    const movement = await client.query(
      `
      SELECT id
      FROM cash_movements
      WHERE shift_id = $1
        AND type = 'expense'
        AND amount = $2
        AND reason = $3
        AND COALESCE(reference, '') = COALESCE($4, '')
        AND ABS(EXTRACT(EPOCH FROM (created_at - $5::timestamptz))) < 1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [
        payload.shiftId,
        Number(payload.amount ?? 0),
        reason,
        payload.reference || '',
        payload.date || expenseRow.created_at
      ]
    ) as { rows: Array<{ id: string }> };

    const movementId = movement.rows[0]?.id;
    if (movementId) {
      await client.query('DELETE FROM cash_movements WHERE id = $1', [movementId]);
      deletedCashMovements = 1;
    }
  }

  await client.query("DELETE FROM app_documents WHERE collection_name = 'expenses' AND id = $1", [expenseId]);

  await insertAuditLog(
    client,
    user,
    'DELETE_RECEIPT',
    `Deleted expense voucher ${expenseId} (${payload.description || payload.category || 'expense'})`
  );

  return {
    ok: true,
    kind: 'expense',
    id: expenseId,
    deleted: {
      expenses: 1,
      cashMovements: deletedCashMovements
    },
    message: `Expense voucher ${expenseId} deleted successfully.`
  } satisfies ReceiptDeleteResult;
}

async function deleteCashShiftReceipt(client: any, shiftId: string, user: Awaited<ReturnType<typeof requirePermission>>) {
  const shift = await client.query(
    `
    SELECT id, status, user_name
    FROM cash_shifts
    WHERE id = $1
    FOR UPDATE
    `,
    [shiftId]
  ) as {
    rows: Array<{
      id: string;
      status: string;
      user_name: string;
    }>;
  };

  const shiftRow = shift.rows[0];
  if (!shiftRow) {
    throw new Error('The selected cash shift report no longer exists');
  }

  if (shiftRow.status !== 'closed') {
    throw new Error('Close the shift before deleting its report');
  }

  const movementCount = await client.query('SELECT COUNT(*)::text AS count FROM cash_movements WHERE shift_id = $1', [shiftId]) as {
    rows: Array<{ count: string }>;
  };
  await client.query('DELETE FROM cash_shifts WHERE id = $1', [shiftId]);

  await insertAuditLog(
    client,
    user,
    'DELETE_RECEIPT',
    `Deleted cash shift report ${shiftId} for ${shiftRow.user_name}`
  );

  return {
    ok: true,
    kind: 'cash-shift',
    id: shiftId,
    deleted: {
      cashShifts: 1,
      cashMovements: Number(movementCount.rows[0]?.count ?? '0')
    },
    message: `Cash shift report ${shiftId} deleted successfully.`
  } satisfies ReceiptDeleteResult;
}

async function deleteReceipt(kind: DeletableReceiptKind, id: string, user: Awaited<ReturnType<typeof requirePermission>>) {
  if (!user) {
    throw new Error('Permission denied');
  }

  return withTransaction(async (client) => {
    if (kind === 'sale' || kind === 'refund') {
      return deleteSingleSaleReceipt(client, id, user);
    }

    if (kind === 'credit-payment') {
      return deleteCreditPaymentReceipt(client, id, user);
    }

    if (kind === 'expense') {
      return deleteExpenseReceipt(client, id, user);
    }

    return deleteCashShiftReceipt(client, id, user);
  });
}

async function buildSystemStatusReport() {
  const [
    userCount,
    activeUserCount,
    branchCount,
    productCount,
    customerCount,
    salesCount,
    saleItemCount,
    creditsCount,
    creditPaymentCount,
    inventoryCount,
    auditCount,
    cashShiftCount,
    cashMovementCount,
    openCashShiftCount,
    lowStockProductCount,
    categoriesCount,
    suppliersCount,
    expenseCount,
    expenseCategoryCount,
    purchaseOrderCount,
    labelTemplateCount,
    labelHistoryCount,
    settingsRow,
    adminCoverageRow,
    salesWithoutItemsRow,
    cashiersWithoutBranchRow,
    productsMissingCategoryRow,
    productsMissingSupplierRow,
    productsNonPositivePriceRow,
    productsNegativeStockRow,
    openCreditsWithoutCustomerRow,
    staleOpenShiftsRow,
    salesWithoutBranchRow,
    inventoryWithoutBranchRow
  ] = await Promise.all([
    countTable('users'),
    queryOne<{ count: string }>("SELECT COUNT(*)::text AS count FROM users WHERE status = 'active'"),
    countTable('branches'),
    countTable('products'),
    countTable('customers'),
    countTable('sales'),
    countTable('sale_items'),
    countTable('credits'),
    countTable('credit_payments'),
    countTable('inventory_ledger'),
    countTable('audit_logs'),
    countTable('cash_shifts'),
    countTable('cash_movements'),
    queryOne<{ count: string }>("SELECT COUNT(*)::text AS count FROM cash_shifts WHERE status = 'open'"),
    queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM products WHERE stock_quantity <= low_stock_threshold'),
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
    ),
    queryOne<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM sales s
      LEFT JOIN sale_items si ON si.sale_id = s.id
      WHERE si.id IS NULL
      `
    ),
    queryOne<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM users WHERE status = 'active' AND role = 'cashier' AND COALESCE(branch_id, '') = ''"
    ),
    queryOne<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM products WHERE COALESCE(category_id, '') = ''"
    ),
    queryOne<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM products WHERE COALESCE(supplier_id, '') = ''"
    ),
    queryOne<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM products WHERE selling_price <= 0'
    ),
    queryOne<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM products WHERE stock_quantity < 0'
    ),
    queryOne<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM credits WHERE status = 'open' AND (customer_id IS NULL OR COALESCE(customer_name, '') = '')"
    ),
    queryOne<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM cash_shifts WHERE status = 'open' AND opened_at < NOW() - INTERVAL '24 hours'"
    ),
    queryOne<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM sales WHERE COALESCE(branch_id, '') = ''"
    ),
    queryOne<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM inventory_ledger WHERE COALESCE(branch_id, '') = ''"
    )
  ]);

  const defaultBranchExistsRow =
    settingsRow?.default_branch_id?.trim()
      ? await queryOne<{ id: string }>('SELECT id FROM branches WHERE id = $1 LIMIT 1', [settingsRow.default_branch_id.trim()])
      : null;

  const receiptPaperWidthMm = Number(settingsRow?.receipt_paper_width_mm ?? 80);
  const receiptFontSizePx = Number(settingsRow?.receipt_font_size_px ?? 12);
  const receiptBrandColor = settingsRow?.receipt_brand_color || '#4f46e5';
  const hasBusinessName = Boolean(settingsRow?.business_name?.trim());
  const hasDefaultBranch = Boolean(settingsRow?.default_branch_id?.trim());
  const hasValidDefaultBranch = !hasDefaultBranch ? false : Boolean(defaultBranchExistsRow?.id);
  const receiptWidthInvalid = !Number.isFinite(receiptPaperWidthMm) || receiptPaperWidthMm < 58 || receiptPaperWidthMm > 120;
  const receiptFontInvalid = !Number.isFinite(receiptFontSizePx) || receiptFontSizePx < 9 || receiptFontSizePx > 18;
  const receiptColorInvalid = !isValidHexColor(receiptBrandColor);

  const counts = {
    users: userCount,
    activeUsers: Number(activeUserCount?.count ?? '0'),
    branches: branchCount,
    products: productCount,
    customers: customerCount,
    sales: salesCount,
    saleItems: saleItemCount,
    credits: creditsCount,
    creditPayments: creditPaymentCount,
    inventoryTransactions: inventoryCount,
    auditLogs: auditCount,
    cashShifts: cashShiftCount,
    cashMovements: cashMovementCount,
    openCashShifts: Number(openCashShiftCount?.count ?? '0'),
    lowStockProducts: Number(lowStockProductCount?.count ?? '0'),
    categories: categoriesCount,
    suppliers: suppliersCount,
    expenses: expenseCount,
    expenseCategories: expenseCategoryCount,
    purchaseOrders: purchaseOrderCount,
    labelTemplates: labelTemplateCount,
    labelHistory: labelHistoryCount
  };

  const diagnostics = {
    salesWithoutItems: Number(salesWithoutItemsRow?.count ?? '0'),
    cashiersWithoutBranch: Number(cashiersWithoutBranchRow?.count ?? '0'),
    productsMissingCategory: Number(productsMissingCategoryRow?.count ?? '0'),
    productsMissingSupplier: Number(productsMissingSupplierRow?.count ?? '0'),
    productsNonPositivePrice: Number(productsNonPositivePriceRow?.count ?? '0'),
    productsNegativeStock: Number(productsNegativeStockRow?.count ?? '0'),
    openCreditsWithoutCustomer: Number(openCreditsWithoutCustomerRow?.count ?? '0'),
    staleOpenShifts: Number(staleOpenShiftsRow?.count ?? '0'),
    salesWithoutBranch: Number(salesWithoutBranchRow?.count ?? '0'),
    inventoryWithoutBranch: Number(inventoryWithoutBranchRow?.count ?? '0')
  };

  const issues: SystemIssue[] = [];
  const pushIssue = (issue: SystemIssue) => issues.push(issue);

  if (counts.branches === 0) {
    pushIssue({
      id: 'no-branches',
      severity: 'critical',
      title: 'No branches configured',
      summary: 'Receipts, user assignment and branch-level reporting need at least one active branch.',
      fix: 'Create a branch in the Branches page, then set it as default in Settings.',
      componentId: 'branches',
      route: '/branches',
      file: 'src/components/Branches.tsx'
    });
  }

  if (counts.products === 0) {
    pushIssue({
      id: 'no-products',
      severity: 'critical',
      title: 'No products available for sale',
      summary: 'The POS screen cannot sell items until products exist.',
      fix: 'Add products with price, stock and barcode/SKU in the Products page.',
      componentId: 'pos',
      route: '/products',
      file: 'src/components/Products.tsx'
    });
  }

  if (counts.categories === 0) {
    pushIssue({
      id: 'no-categories',
      severity: 'warning',
      title: 'No product categories found',
      summary: 'Products can still exist, but catalog organization and reporting will be weaker.',
      fix: 'Create at least one category from the Categories page and link products to it.',
      componentId: 'categories',
      route: '/categories',
      file: 'src/components/Categories.tsx'
    });
  }

  if (counts.suppliers === 0) {
    pushIssue({
      id: 'no-suppliers',
      severity: 'warning',
      title: 'No suppliers configured',
      summary: 'Receiving, procurement and supplier-based cost tracking work better with supplier records.',
      fix: 'Create suppliers in the Suppliers page before raising purchase orders or receiving stock.',
      componentId: 'suppliers',
      route: '/suppliers',
      file: 'src/components/Suppliers.tsx'
    });
  }

  if (!hasBusinessName) {
    pushIssue({
      id: 'missing-business-name',
      severity: 'warning',
      title: 'Receipt identity is incomplete',
      summary: 'Business name is missing from system settings, which weakens receipt branding.',
      fix: 'Set business identity and receipt appearance in Settings.',
      componentId: 'settings',
      route: '/settings',
      file: 'src/components/Settings.tsx'
    });
  }

  if (!hasDefaultBranch) {
    pushIssue({
      id: 'missing-default-branch',
      severity: 'warning',
      title: 'Default branch is not configured',
      summary: 'Fallback branch selection is missing for receipts and branch-aware operations.',
      fix: 'Choose a default branch inside Settings.',
      componentId: 'settings',
      route: '/settings',
      file: 'src/components/Settings.tsx'
    });
  }

  if (hasDefaultBranch && !hasValidDefaultBranch) {
    pushIssue({
      id: 'invalid-default-branch',
      severity: 'critical',
      title: 'Default branch points to a missing branch record',
      summary: 'Settings references a default branch that no longer exists, which breaks branch-aware receipts and fallbacks.',
      fix: 'Pick an existing default branch in Settings or recreate the missing branch in the Branches page.',
      componentId: 'settings',
      route: '/settings',
      file: 'src/components/Settings.tsx'
    });
  }

  if (receiptWidthInvalid) {
    pushIssue({
      id: 'invalid-receipt-width',
      severity: 'warning',
      title: 'Receipt paper width is outside the supported range',
      summary: `The configured receipt width (${receiptPaperWidthMm}) should stay between 58mm and 120mm.`,
      fix: 'Open Settings and set the receipt paper width to a value between 58 and 120.',
      componentId: 'settings',
      route: '/settings',
      file: 'src/components/Settings.tsx'
    });
  }

  if (receiptFontInvalid) {
    pushIssue({
      id: 'invalid-receipt-font-size',
      severity: 'warning',
      title: 'Receipt font size is outside the supported range',
      summary: `The configured receipt font size (${receiptFontSizePx}) should stay between 9px and 18px.`,
      fix: 'Open Settings and set the receipt base font size to a value between 9 and 18.',
      componentId: 'settings',
      route: '/settings',
      file: 'src/components/Settings.tsx'
    });
  }

  if (receiptColorInvalid) {
    pushIssue({
      id: 'invalid-receipt-color',
      severity: 'warning',
      title: 'Receipt brand color is invalid',
      summary: `The receipt brand color "${receiptBrandColor}" is not a valid hex color value.`,
      fix: 'Open Settings and set the receipt brand color to a valid hex value like #4f46e5.',
      componentId: 'settings',
      route: '/settings',
      file: 'src/components/Settings.tsx'
    });
  }

  if (settingsRow?.drawer_enabled && !settingsRow?.drawer_helper_url?.trim()) {
    pushIssue({
      id: 'drawer-helper-missing',
      severity: 'warning',
      title: 'Cash drawer helper URL is missing',
      summary: 'Drawer integration is enabled, but no local helper URL is configured.',
      fix: 'Set the local drawer helper URL in Settings or disable drawer integration.',
      componentId: 'settings',
      route: '/settings',
      file: 'src/components/Settings.tsx'
    });
  }

  if (Number(adminCoverageRow?.superadmin_count ?? '0') === 0) {
    pushIssue({
      id: 'no-superadmin',
      severity: 'critical',
      title: 'No active superadmin account found',
      summary: 'Recovery and full-system administration require at least one active superadmin.',
      fix: 'Restore or create a superadmin account from admin tooling or database recovery.',
      componentId: 'users',
      route: '/users',
      file: 'src/components/Users.tsx'
    });
  }

  if (diagnostics.cashiersWithoutBranch > 0) {
    pushIssue({
      id: 'cashiers-without-branch',
      severity: 'warning',
      title: 'One or more active cashiers do not have a branch assignment',
      summary: `${diagnostics.cashiersWithoutBranch} active cashier account(s) are missing a branch, which can break branch-aware receipts and till context.`,
      fix: 'Open Users and assign each active cashier to the correct branch.',
      componentId: 'users',
      route: '/users',
      file: 'src/components/Users.tsx'
    });
  }

  if (counts.expenseCategories === 0) {
    pushIssue({
      id: 'no-expense-categories',
      severity: 'info',
      title: 'No expense categories configured',
      summary: 'Expense entry still works, but reporting is clearer with proper categories.',
      fix: 'Create expense categories from the Expenses page.',
      componentId: 'expenses',
      route: '/expenses',
      file: 'src/components/Expenses.tsx'
    });
  }

  if (counts.sales === 0) {
    pushIssue({
      id: 'no-sales-history',
      severity: 'info',
      title: 'No sales history recorded yet',
      summary: 'Sales dashboards, history and profit reporting will stay empty until trading begins.',
      fix: 'Complete a sale from the Sale page to start building operational history.',
      componentId: 'sales-history',
      route: '/sales-history',
      file: 'src/components/SalesHistory.tsx'
    });
  }

  if (diagnostics.salesWithoutItems > 0) {
    pushIssue({
      id: 'sales-without-items',
      severity: 'critical',
      title: 'Some sales are missing line items',
      summary: `${diagnostics.salesWithoutItems} sale record(s) do not have matching sale items, which can break history, refunds, and profit reports.`,
      fix: 'Inspect recent sale writes and repair the affected sales before relying on refund and profit reporting.',
      componentId: 'sales-history',
      route: '/sales-history',
      file: 'src/components/SalesHistory.tsx'
    });
  }

  if (diagnostics.openCreditsWithoutCustomer > 0) {
    pushIssue({
      id: 'open-credits-without-customer',
      severity: 'warning',
      title: 'Open credits exist without a proper customer link',
      summary: `${diagnostics.openCreditsWithoutCustomer} open credit record(s) are missing a customer reference or customer name.`,
      fix: 'Review the Credits page and make sure every credit sale is attached to a customer before checkout completes.',
      componentId: 'credits',
      route: '/credits',
      file: 'src/components/Credits.tsx'
    });
  }

  if (diagnostics.productsMissingCategory > 0) {
    pushIssue({
      id: 'products-missing-category',
      severity: 'warning',
      title: 'Some products are missing categories',
      summary: `${diagnostics.productsMissingCategory} product(s) do not have a category, which weakens filtering and reporting.`,
      fix: 'Open Products and assign categories to the affected items.',
      componentId: 'products',
      route: '/products',
      file: 'src/components/Products.tsx'
    });
  }

  if (diagnostics.productsMissingSupplier > 0) {
    pushIssue({
      id: 'products-missing-supplier',
      severity: 'warning',
      title: 'Some products are missing suppliers',
      summary: `${diagnostics.productsMissingSupplier} product(s) do not have a supplier link, which weakens purchasing and receiving traceability.`,
      fix: 'Open Products and assign suppliers to the affected items, or create missing supplier records first.',
      componentId: 'products',
      route: '/products',
      file: 'src/components/Products.tsx'
    });
  }

  if (diagnostics.productsNonPositivePrice > 0) {
    pushIssue({
      id: 'products-non-positive-price',
      severity: 'critical',
      title: 'Some products have a zero or negative selling price',
      summary: `${diagnostics.productsNonPositivePrice} product(s) have a selling price less than or equal to zero, which can break checkout and profit calculations.`,
      fix: 'Open Products and correct the selling price on the affected items before further sales.',
      componentId: 'products',
      route: '/products',
      file: 'src/components/Products.tsx'
    });
  }

  if (diagnostics.productsNegativeStock > 0) {
    pushIssue({
      id: 'negative-stock-detected',
      severity: 'critical',
      title: 'Negative stock was detected',
      summary: `${diagnostics.productsNegativeStock} product(s) have stock below zero, which signals broken stock movement history or overselling.`,
      fix: 'Review Inventory and recent sales/refund activity, then correct the affected quantities with an adjustment after confirming the real stock count.',
      componentId: 'inventory',
      route: '/inventory',
      file: 'src/components/Inventory.tsx'
    });
  }

  if (diagnostics.staleOpenShifts > 0) {
    pushIssue({
      id: 'stale-open-shifts',
      severity: 'warning',
      title: 'Some cashier shifts have stayed open too long',
      summary: `${diagnostics.staleOpenShifts} open shift(s) are older than 24 hours, which can distort cash reconciliation and drawer totals.`,
      fix: 'Close stale shifts from Cash Shifts after confirming counted cash and expected cash.',
      componentId: 'shifts',
      route: '/cash-shifts',
      file: 'src/components/CashShifts.tsx'
    });
  }

  if (counts.branches > 0 && diagnostics.salesWithoutBranch > 0) {
    pushIssue({
      id: 'sales-without-branch',
      severity: 'warning',
      title: 'Some sales are missing branch context',
      summary: `${diagnostics.salesWithoutBranch} sale record(s) do not have a branch ID, which can weaken receipt identity and branch reports.`,
      fix: 'Make sure a default branch is set in Settings and staff are assigned to branches before checkout.',
      componentId: 'reports',
      route: '/reports',
      file: 'src/components/Reports.tsx'
    });
  }

  if (counts.branches > 0 && diagnostics.inventoryWithoutBranch > 0) {
    pushIssue({
      id: 'inventory-without-branch',
      severity: 'warning',
      title: 'Some inventory movements are missing branch context',
      summary: `${diagnostics.inventoryWithoutBranch} inventory ledger row(s) do not have a branch ID, which weakens branch stock traceability.`,
      fix: 'Use branch-aware receiving and adjustments after confirming default branch and cashier assignments.',
      componentId: 'inventory',
      route: '/inventory',
      file: 'src/components/Inventory.tsx'
    });
  }

  if (counts.auditLogs === 0 && (counts.sales > 0 || counts.cashShifts > 0 || counts.expenses > 0)) {
    pushIssue({
      id: 'audit-trail-empty',
      severity: 'warning',
      title: 'Operational history exists, but the audit trail is empty',
      summary: 'The system has live activity records but no audit log coverage, which weakens troubleshooting and accountability.',
      fix: 'Inspect audit logging flows in operational writes and confirm audit events are being recorded.',
      componentId: 'audit-logs',
      route: '/audit-logs',
      file: 'src/components/AuditLogs.tsx'
    });
  }

  if (counts.labelTemplates === 0) {
    pushIssue({
      id: 'no-label-templates',
      severity: 'info',
      title: 'No barcode label templates are configured',
      summary: 'Label printing is available, but no reusable label templates are stored yet.',
      fix: 'Open Labels and save at least one label template for repeat printing.',
      componentId: 'labels',
      route: '/labels',
      file: 'src/components/Labels.tsx'
    });
  }

  const issueSummary = issues.reduce(
    (summary, issue) => {
      summary[issue.severity] += 1;
      return summary;
    },
    { critical: 0, warning: 0, info: 0 }
  );

  const dataIntegritySeverity =
    diagnostics.salesWithoutItems > 0 || diagnostics.productsNonPositivePrice > 0 || diagnostics.productsNegativeStock > 0
      ? 'error'
      : diagnostics.openCreditsWithoutCustomer > 0 || diagnostics.salesWithoutBranch > 0 || diagnostics.inventoryWithoutBranch > 0
        ? 'warning'
        : 'ok';

  const receiptServiceSeverity =
    !hasBusinessName || (hasDefaultBranch && !hasValidDefaultBranch)
      ? 'error'
      : receiptWidthInvalid || receiptFontInvalid || receiptColorInvalid || !hasDefaultBranch
        ? 'warning'
        : 'ok';

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
      id: 'data-integrity',
      label: 'Data Integrity',
      status: dataIntegritySeverity,
      message:
        dataIntegritySeverity === 'error'
          ? 'Critical record inconsistencies were detected. Review sales history, products, inventory and credits before normal trading continues.'
          : dataIntegritySeverity === 'warning'
            ? 'Operational data is present, but some records are missing branch or customer context.'
            : 'No critical sales, inventory, or credit integrity issues were detected in the current snapshot.'
    },
    {
      id: 'receipts',
      label: 'Receipt Configuration',
      status: receiptServiceSeverity,
      message:
        receiptServiceSeverity === 'error'
          ? 'Receipt setup has a missing business identity or a broken default branch reference.'
          : receiptServiceSeverity === 'warning'
            ? 'Receipt setup is present, but one or more appearance or branch settings still need attention.'
            : `Configured at ${receiptPaperWidthMm}mm width and ${receiptFontSizePx}px base font.`
    },
    {
      id: 'cash-drawer',
      label: 'Cash Drawer',
      status: settingsRow?.drawer_enabled && !settingsRow?.drawer_helper_url?.trim() ? ('warning' as const) : ('ok' as const),
      message: settingsRow?.drawer_enabled
        ? `Drawer helper enabled at ${settingsRow.drawer_helper_url || 'no URL set'}.`
        : 'Drawer helper is disabled.'
    }
  ];

  const issuesByComponent = new Map<string, SystemIssue[]>();
  for (const issue of issues) {
    if (!issue.componentId) {
      continue;
    }

    const componentIssues = issuesByComponent.get(issue.componentId) || [];
    componentIssues.push(issue);
    issuesByComponent.set(issue.componentId, componentIssues);
  }

  const healthyModuleSummaries: Record<string, string> = {
    dashboard:
      counts.sales > 0
        ? `Dashboard widgets have ${counts.sales.toLocaleString()} sale record(s) available for KPIs and recent activity.`
        : 'Dashboard layout is healthy and will populate as sales, shifts and expenses start coming in.',
    pos:
      counts.products > 0
        ? `Sale flow has ${counts.products.toLocaleString()} product(s) ready for scanner-first checkout.`
        : 'Sale flow is waiting for sellable products.',
    'sales-history':
      counts.sales > 0
        ? `Sales History has ${counts.sales.toLocaleString()} sale record(s) and ${counts.saleItems.toLocaleString()} line item(s) available for review.`
        : 'Sales History is ready, but no completed sales have been recorded yet.',
    shifts:
      counts.cashShifts > 0
        ? `Cash Shifts has ${counts.cashShifts.toLocaleString()} recorded shift(s) and ${counts.openCashShifts.toLocaleString()} currently open shift(s).`
        : 'Cash Shifts is ready for the next till opening.',
    customers:
      counts.customers > 0
        ? `Customers has ${counts.customers.toLocaleString()} customer record(s) available for credit and receipt linkage.`
        : 'Customers is healthy, but no customer profiles have been added yet.',
    credits:
      counts.credits > 0
        ? `Credits has ${counts.credits.toLocaleString()} credit record(s) and ${counts.creditPayments.toLocaleString()} payment receipt(s).`
        : 'Credits is healthy and waiting for the first credit sale.',
    products:
      counts.products > 0
        ? `Products has ${counts.products.toLocaleString()} product(s) with ${counts.lowStockProducts.toLocaleString()} currently at or below low-stock level.`
        : 'Products is waiting for inventory items to be created.',
    categories:
      counts.categories > 0
        ? `Categories has ${counts.categories.toLocaleString()} saved category record(s).`
        : 'Categories needs at least one category to improve catalog structure.',
    inventory:
      counts.inventoryTransactions > 0
        ? `Inventory is tracking ${counts.inventoryTransactions.toLocaleString()} stock movement record(s).`
        : 'Inventory is healthy, but no stock movement history has been recorded yet.',
    'purchase-orders':
      counts.purchaseOrders > 0
        ? `Purchase Orders has ${counts.purchaseOrders.toLocaleString()} saved purchase order record(s).`
        : 'Purchase Orders is healthy and ready for procurement activity.',
    suppliers:
      counts.suppliers > 0
        ? `Suppliers has ${counts.suppliers.toLocaleString()} supplier record(s) available for receiving and procurement.`
        : 'Suppliers needs supplier records before procurement becomes fully traceable.',
    branches:
      counts.branches > 0
        ? `Branches has ${counts.branches.toLocaleString()} branch record(s) configured for till assignment and receipts.`
        : 'Branches needs at least one store location.',
    labels:
      counts.labelTemplates > 0
        ? `Labels has ${counts.labelTemplates.toLocaleString()} template(s) and ${counts.labelHistory.toLocaleString()} print history record(s).`
        : 'Labels is healthy, but no reusable templates are stored yet.',
    users:
      counts.activeUsers > 0
        ? `Users has ${counts.activeUsers.toLocaleString()} active account(s) available for sign-in.`
        : 'Users needs at least one active account.',
    'audit-logs':
      counts.auditLogs > 0
        ? `Audit Logs has ${counts.auditLogs.toLocaleString()} recorded audit event(s).`
        : 'Audit Logs is enabled, but no audit events have been captured yet.',
    expenses:
      counts.expenses > 0
        ? `Expenses has ${counts.expenses.toLocaleString()} recorded voucher(s) across ${counts.expenseCategories.toLocaleString()} expense categor${counts.expenseCategories === 1 ? 'y' : 'ies'}.`
        : 'Expenses is healthy and waiting for the first recorded expense.',
    reports:
      counts.sales > 0 || counts.expenses > 0 || counts.inventoryTransactions > 0
        ? 'Reports has the operational data it needs to export sales, profit, expense and movement reports.'
        : 'Reports is ready, but exports will stay light until the system builds more trading history.',
    settings:
      hasBusinessName
        ? 'Settings has active receipt, scanner and branch controls available for administration.'
        : 'Settings is available, but store identity still needs configuration.',
    status:
      issues.length > 0
        ? `System Status detected ${issueSummary.critical} critical, ${issueSummary.warning} warning, and ${issueSummary.info} informational issue(s).`
        : 'System Status did not detect any current configuration or data integrity warnings.'
  };

  const moduleHealth: ModuleHealthEntry[] = COMPONENT_CATALOG.map((component) => {
    const componentIssues = issuesByComponent.get(component.id) || [];
    const status: ModuleHealthStatus = componentIssues.some((issue) => issue.severity === 'critical')
      ? 'error'
      : componentIssues.length > 0
        ? 'warning'
        : 'ok';

    return {
      ...component,
      status,
      summary:
        componentIssues.length > 0
          ? `${componentIssues.length} issue(s) detected. ${componentIssues[0]?.summary || component.functionality}`
          : healthyModuleSummaries[component.id] || component.functionality,
      fix:
        componentIssues.length > 0
          ? componentIssues
              .slice(0, 2)
              .map((issue) => issue.fix)
              .join(' ')
          : undefined,
      issueCount: componentIssues.length
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    services,
    issueSummary,
    counts,
    issues,
    moduleHealth,
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
      brandColor: receiptBrandColor,
      paperWidthMm: receiptPaperWidthMm,
      fontSizePx: receiptFontSizePx,
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

      const requestUrl = new URL(req.url || '/', 'http://localhost');
      if (requestUrl.searchParams.get('view') === 'receipts') {
        const filters = parseReceiptSearchFilters(req);
        return res.status(200).json(await searchReceipts(filters));
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

      const body = await readJsonBody<{
        action?: 'delete-receipt';
        scope?: HistoryScopeId;
        kind?: DeletableReceiptKind;
        id?: string;
      }>(req);

      if (body.action === 'delete-receipt') {
        if (!body.kind || !RECEIPT_KIND_OPTIONS.includes(body.kind) || !(body.id || '').trim()) {
          return res.status(400).json({ error: 'A valid receipt kind and receipt ID are required' });
        }

        return res.status(200).json(await deleteReceipt(body.kind, body.id.trim(), user));
      }

      const scope = body.scope;
      if (!scope || !['sales', 'cash-shifts', 'inventory', 'expenses', 'audit', 'purchase-orders', 'label-history', 'all'].includes(scope)) {
        return res.status(400).json({ error: 'A valid cleanup scope is required' });
      }

      return res.status(200).json(await purgeHistoryScope(scope, user));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown server error';
      const statusCode =
        message.includes('required') || message.includes('selected') || message.includes('Close the shift')
          ? 400
          : 500;
      return res.status(statusCode).json({ error: message });
    }
  }

  return sendMethodNotAllowed(res, ['GET', 'POST']);
}
