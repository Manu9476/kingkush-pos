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
