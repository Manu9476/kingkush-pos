import type { PoolClient } from '@neondatabase/serverless';

import { getSessionUser, hasPermission } from '../backend/lib/auth.js';
import { readJsonBody } from '../backend/lib/http.js';
import { createId, queryOne, queryRows, queryResult, withTransaction } from '../backend/lib/db.js';

type QueryConstraint =
  | { type: 'where'; field: string; op: '=='; value: unknown }
  | { type: 'orderBy'; field: string; direction?: 'asc' | 'desc' }
  | { type: 'limit'; count: number };

type DataRequestBody =
  | {
      mode: 'doc';
      path: string;
    }
  | {
      mode: 'query';
      source: { kind: 'collection'; path: string } | { kind: 'collectionGroup'; collectionId: string };
      constraints?: QueryConstraint[];
    }
  | {
      mode: 'write';
      action: 'set' | 'add' | 'update' | 'delete' | 'batch';
      path?: string;
      collectionPath?: string;
      data?: Record<string, unknown>;
      operations?: Array<{
        action: 'set' | 'add' | 'update' | 'delete';
        path?: string;
        collectionPath?: string;
        data?: Record<string, unknown>;
      }>;
    };

type FieldType = 'text' | 'number' | 'integer' | 'boolean' | 'timestamp' | 'json';

type ExplicitConfig = {
  table: string;
  readPermissions: string[];
  writePermissions?: string[];
  fieldMap: Record<string, { column: string; type: FieldType }>;
  writableFields?: string[];
  allowCreate?: boolean;
  allowDelete?: boolean;
  readOnly?: boolean;
  serialize: (row: Record<string, unknown>) => Record<string, unknown>;
};

const explicitCollections: Record<string, ExplicitConfig> = {
  users: {
    table: 'users',
    readPermissions: ['users'],
    writePermissions: ['users'],
    fieldMap: {
      username: { column: 'username', type: 'text' },
      email: { column: 'email', type: 'text' },
      displayName: { column: 'display_name', type: 'text' },
      branchId: { column: 'branch_id', type: 'text' },
      role: { column: 'role', type: 'text' },
      permissions: { column: 'permissions', type: 'json' },
      status: { column: 'status', type: 'text' },
      createdAt: { column: 'created_at', type: 'timestamp' }
    },
    writableFields: ['displayName', 'branchId', 'role', 'permissions', 'status'],
    allowDelete: true,
    serialize: (row) => ({
      uid: row.id,
      username: row.username,
      email: row.email,
      displayName: row.display_name,
      branchId: row.branch_id,
      role: row.role,
      permissions: normalizeJsonArray(row.permissions),
      status: row.status,
      createdAt: toIsoString(row.created_at)
    })
  },
  settings: {
    table: 'system_settings',
    readPermissions: ['settings', 'pos', 'products', 'credits', 'reports', 'branches'],
    writePermissions: ['settings'],
    fieldMap: {
      skuPrefix: { column: 'sku_prefix', type: 'text' },
      badDebtThresholdDays: { column: 'bad_debt_threshold_days', type: 'integer' },
      taxRate: { column: 'tax_rate', type: 'number' },
      loyaltyPointRate: { column: 'loyalty_point_rate', type: 'integer' },
      businessName: { column: 'business_name', type: 'text' },
      storeAddress: { column: 'store_address', type: 'text' },
      storePhone: { column: 'store_phone', type: 'text' },
      storeEmail: { column: 'store_email', type: 'text' },
      receiptHeader: { column: 'receipt_header', type: 'text' },
      receiptFooter: { column: 'receipt_footer', type: 'text' },
      receiptAutoPrint: { column: 'receipt_auto_print', type: 'boolean' },
      drawerEnabled: { column: 'drawer_enabled', type: 'boolean' },
      drawerAutoOpenOnCashSale: { column: 'drawer_auto_open_on_cash_sale', type: 'boolean' },
      drawerHelperUrl: { column: 'drawer_helper_url', type: 'text' },
      barcodeAutofocus: { column: 'barcode_autofocus', type: 'boolean' },
      barcodeSubmitDelayMs: { column: 'barcode_submit_delay_ms', type: 'integer' },
      defaultBranchId: { column: 'default_branch_id', type: 'text' },
      updatedAt: { column: 'updated_at', type: 'timestamp' }
    },
    writableFields: [
      'skuPrefix',
      'badDebtThresholdDays',
      'taxRate',
      'loyaltyPointRate',
      'businessName',
      'storeAddress',
      'storePhone',
      'storeEmail',
      'receiptHeader',
      'receiptFooter',
      'receiptAutoPrint',
      'drawerEnabled',
      'drawerAutoOpenOnCashSale',
      'drawerHelperUrl',
      'barcodeAutofocus',
      'barcodeSubmitDelayMs',
      'defaultBranchId',
      'updatedAt'
    ],
    allowCreate: true,
    serialize: (row) => ({
      id: row.id,
      skuPrefix: row.sku_prefix,
      badDebtThresholdDays: Number(row.bad_debt_threshold_days ?? 30),
      taxRate: Number(row.tax_rate ?? 0),
      loyaltyPointRate: Number(row.loyalty_point_rate ?? 100),
      businessName: row.business_name,
      storeAddress: row.store_address,
      storePhone: row.store_phone,
      storeEmail: row.store_email,
      receiptHeader: row.receipt_header,
      receiptFooter: row.receipt_footer,
      receiptAutoPrint: Boolean(row.receipt_auto_print),
      drawerEnabled: Boolean(row.drawer_enabled),
      drawerAutoOpenOnCashSale: Boolean(row.drawer_auto_open_on_cash_sale),
      drawerHelperUrl: row.drawer_helper_url,
      barcodeAutofocus: row.barcode_autofocus === undefined ? true : Boolean(row.barcode_autofocus),
      barcodeSubmitDelayMs: Number(row.barcode_submit_delay_ms ?? 120),
      defaultBranchId: row.default_branch_id,
      updatedAt: toIsoString(row.updated_at)
    })
  },
  branches: {
    table: 'branches',
    readPermissions: ['branches', 'settings', 'pos', 'reports', 'inventory', 'users', 'purchase-orders'],
    writePermissions: ['branches', 'settings'],
    fieldMap: {
      code: { column: 'code', type: 'text' },
      name: { column: 'name', type: 'text' },
      address: { column: 'address', type: 'text' },
      phone: { column: 'phone', type: 'text' },
      email: { column: 'email', type: 'text' },
      status: { column: 'status', type: 'text' },
      createdAt: { column: 'created_at', type: 'timestamp' },
      updatedAt: { column: 'updated_at', type: 'timestamp' }
    },
    writableFields: ['code', 'name', 'address', 'phone', 'email', 'status', 'updatedAt'],
    allowCreate: true,
    allowDelete: true,
    serialize: (row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      address: row.address,
      phone: row.phone,
      email: row.email,
      status: row.status,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at)
    })
  },
  products: {
    table: 'products',
    readPermissions: ['products', 'pos', 'inventory', 'purchase-orders', 'labels', 'reports'],
    writePermissions: ['products', 'purchase-orders'],
    fieldMap: {
      sku: { column: 'sku', type: 'text' },
      barcode: { column: 'barcode', type: 'text' },
      name: { column: 'name', type: 'text' },
      categoryId: { column: 'category_id', type: 'text' },
      supplierId: { column: 'supplier_id', type: 'text' },
      buyingPrice: { column: 'buying_price', type: 'number' },
      sellingPrice: { column: 'selling_price', type: 'number' },
      stockQuantity: { column: 'stock_quantity', type: 'integer' },
      unitType: { column: 'unit_type', type: 'text' },
      expiryDate: { column: 'expiry_date', type: 'timestamp' },
      lowStockThreshold: { column: 'low_stock_threshold', type: 'integer' },
      isHotItem: { column: 'is_hot_item', type: 'boolean' },
      createdAt: { column: 'created_at', type: 'timestamp' },
      updatedAt: { column: 'updated_at', type: 'timestamp' }
    },
    writableFields: [
      'sku',
      'barcode',
      'name',
      'categoryId',
      'supplierId',
      'buyingPrice',
      'sellingPrice',
      'stockQuantity',
      'unitType',
      'expiryDate',
      'lowStockThreshold',
      'isHotItem',
      'createdAt',
      'updatedAt'
    ],
    allowCreate: true,
    allowDelete: true,
    serialize: (row) => ({
      id: row.id,
      sku: row.sku,
      barcode: row.barcode,
      name: row.name,
      categoryId: row.category_id,
      supplierId: row.supplier_id,
      buyingPrice: Number(row.buying_price ?? 0),
      sellingPrice: Number(row.selling_price ?? 0),
      stockQuantity: Number(row.stock_quantity ?? 0),
      unitType: row.unit_type,
      expiryDate: toNullableIsoString(row.expiry_date),
      lowStockThreshold: Number(row.low_stock_threshold ?? 5),
      isHotItem: Boolean(row.is_hot_item),
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at)
    })
  },
  customers: {
    table: 'customers',
    readPermissions: ['customers', 'pos', 'credits', 'reports'],
    writePermissions: ['customers', 'pos'],
    fieldMap: {
      customerCode: { column: 'customer_code', type: 'text' },
      name: { column: 'name', type: 'text' },
      phone: { column: 'phone', type: 'text' },
      email: { column: 'email', type: 'text' },
      address: { column: 'address', type: 'text' },
      loyaltyPoints: { column: 'loyalty_points', type: 'integer' },
      totalBalance: { column: 'total_balance', type: 'number' },
      createdAt: { column: 'created_at', type: 'timestamp' },
      updatedAt: { column: 'updated_at', type: 'timestamp' }
    },
    writableFields: ['customerCode', 'name', 'phone', 'email', 'address', 'loyaltyPoints', 'totalBalance', 'createdAt'],
    allowCreate: true,
    allowDelete: true,
    serialize: (row) => ({
      id: row.id,
      customerCode: row.customer_code,
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      loyaltyPoints: Number(row.loyalty_points ?? 0),
      totalBalance: Number(row.total_balance ?? 0),
      createdAt: toIsoString(row.created_at)
    })
  }
};

Object.assign(explicitCollections, {
  sales: {
    table: 'sales',
    readPermissions: ['pos', 'sales-history', 'customers', 'reports'],
    fieldMap: {
      cashierId: { column: 'cashier_id', type: 'text' },
      cashierName: { column: 'cashier_name', type: 'text' },
      totalAmount: { column: 'total_amount', type: 'number' },
      taxAmount: { column: 'tax_amount', type: 'number' },
      paymentMethod: { column: 'payment_method', type: 'text' },
      amountPaid: { column: 'amount_paid', type: 'number' },
      balance: { column: 'balance', type: 'number' },
      customerName: { column: 'customer_name', type: 'text' },
      customerId: { column: 'customer_id', type: 'text' },
      reference: { column: 'reference', type: 'text' },
      isCredit: { column: 'is_credit', type: 'boolean' },
      isRefunded: { column: 'is_refunded', type: 'boolean' },
      refundAmount: { column: 'refund_amount', type: 'number' },
      refundedAt: { column: 'refunded_at', type: 'timestamp' },
      refundedBy: { column: 'refunded_by', type: 'text' },
      refundReason: { column: 'refund_reason', type: 'text' },
      outstandingBalance: { column: 'outstanding_balance', type: 'number' },
      branchId: { column: 'branch_id', type: 'text' },
      shiftId: { column: 'shift_id', type: 'text' },
      tenderMethod: { column: 'tender_method', type: 'text' },
      timestamp: { column: 'sold_at', type: 'timestamp' }
    },
    readOnly: true,
    serialize: (row) => ({
      id: row.id,
      cashierId: row.cashier_id,
      cashierName: row.cashier_name,
      totalAmount: Number(row.total_amount ?? 0),
      taxAmount: Number(row.tax_amount ?? 0),
      paymentMethod: row.payment_method,
      amountPaid: Number(row.amount_paid ?? 0),
      balance: Number(row.balance ?? 0),
      customerName: row.customer_name,
      customerId: row.customer_id,
      reference: row.reference,
      isCredit: Boolean(row.is_credit),
      isRefunded: Boolean(row.is_refunded),
      refundAmount: Number(row.refund_amount ?? 0),
      refundedAt: toNullableIsoString(row.refunded_at),
      refundedBy: row.refunded_by,
      refundReason: row.refund_reason,
      outstandingBalance: Number(row.outstanding_balance ?? 0),
      branchId: row.branch_id,
      shiftId: row.shift_id,
      tenderMethod: row.tender_method,
      timestamp: toIsoString(row.sold_at)
    })
  },
  credits: {
    table: 'credits',
    readPermissions: ['credits', 'pos', 'customers', 'reports'],
    fieldMap: {
      saleId: { column: 'sale_id', type: 'text' },
      customerId: { column: 'customer_id', type: 'text' },
      customerName: { column: 'customer_name', type: 'text' },
      totalAmount: { column: 'total_amount', type: 'number' },
      amountPaid: { column: 'amount_paid', type: 'number' },
      outstandingBalance: { column: 'outstanding_balance', type: 'number' },
      items: { column: 'items', type: 'text' },
      status: { column: 'status', type: 'text' },
      timestamp: { column: 'created_at', type: 'timestamp' },
      refundedAt: { column: 'refunded_at', type: 'timestamp' }
    },
    readOnly: true,
    serialize: (row) => ({
      id: row.id,
      saleId: row.sale_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      totalAmount: Number(row.total_amount ?? 0),
      amountPaid: Number(row.amount_paid ?? 0),
      outstandingBalance: Number(row.outstanding_balance ?? 0),
      items: row.items,
      status: row.status,
      timestamp: toIsoString(row.created_at),
      refundedAt: toNullableIsoString(row.refunded_at)
    })
  },
  credit_payments: {
    table: 'credit_payments',
    readPermissions: ['credits', 'reports'],
    fieldMap: {
      creditId: { column: 'credit_id', type: 'text' },
      saleId: { column: 'sale_id', type: 'text' },
      amountPaid: { column: 'amount_paid', type: 'number' },
      remainingBalance: { column: 'remaining_balance', type: 'number' },
      paymentMethod: { column: 'payment_method', type: 'text' },
      reference: { column: 'reference', type: 'text' },
      cashierId: { column: 'cashier_id', type: 'text' },
      cashierName: { column: 'cashier_name', type: 'text' },
      branchId: { column: 'branch_id', type: 'text' },
      shiftId: { column: 'shift_id', type: 'text' },
      timestamp: { column: 'paid_at', type: 'timestamp' }
    },
    readOnly: true,
    serialize: (row) => ({
      id: row.id,
      creditId: row.credit_id,
      saleId: row.sale_id,
      amountPaid: Number(row.amount_paid ?? 0),
      remainingBalance: Number(row.remaining_balance ?? 0),
      paymentMethod: row.payment_method,
      reference: row.reference,
      cashierId: row.cashier_id,
      cashierName: row.cashier_name,
      branchId: row.branch_id,
      shiftId: row.shift_id,
      timestamp: toIsoString(row.paid_at)
    })
  },
  inventory_transactions: {
    table: 'inventory_ledger',
    readPermissions: ['inventory', 'reports'],
    fieldMap: {
      productId: { column: 'product_id', type: 'text' },
      type: { column: 'type', type: 'text' },
      quantity: { column: 'quantity', type: 'integer' },
      reason: { column: 'reason', type: 'text' },
      userId: { column: 'user_id', type: 'text' },
      timestamp: { column: 'created_at', type: 'timestamp' },
      supplierId: { column: 'supplier_id', type: 'text' },
      unitCost: { column: 'unit_cost', type: 'number' },
      reference: { column: 'reference', type: 'text' },
      notes: { column: 'notes', type: 'text' },
      sourceType: { column: 'source_type', type: 'text' },
      sourceId: { column: 'source_id', type: 'text' },
      branchId: { column: 'branch_id', type: 'text' }
    },
    readOnly: true,
    serialize: (row) => ({
      id: row.id,
      productId: row.product_id,
      type: row.type,
      quantity: Number(row.quantity ?? 0),
      reason: row.reason,
      userId: row.user_id,
      timestamp: toIsoString(row.created_at),
      supplierId: row.supplier_id,
      unitCost: row.unit_cost === null || row.unit_cost === undefined ? undefined : Number(row.unit_cost),
      reference: row.reference,
      notes: row.notes,
      sourceType: row.source_type,
      sourceId: row.source_id,
      branchId: row.branch_id
    })
  },
  audit_logs: {
    table: 'audit_logs',
    readPermissions: ['audit-logs'],
    writePermissions: ['audit-logs', 'users', 'settings', 'credits', 'inventory', 'purchase-orders', 'pos', 'expenses'],
    fieldMap: {
      userId: { column: 'user_id', type: 'text' },
      userName: { column: 'user_name', type: 'text' },
      action: { column: 'action', type: 'text' },
      details: { column: 'details', type: 'text' },
      branchId: { column: 'branch_id', type: 'text' },
      timestamp: { column: 'created_at', type: 'timestamp' }
    },
    writableFields: ['userId', 'userName', 'action', 'details', 'branchId', 'timestamp'],
    allowCreate: true,
    serialize: (row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      action: row.action,
      details: row.details,
      branchId: row.branch_id,
      timestamp: toIsoString(row.created_at)
    })
  },
  cash_shifts: {
    table: 'cash_shifts',
    readPermissions: ['shifts', 'reports', 'pos'],
    fieldMap: {
      userId: { column: 'user_id', type: 'text' },
      userName: { column: 'user_name', type: 'text' },
      branchId: { column: 'branch_id', type: 'text' },
      openingFloat: { column: 'opening_float', type: 'number' },
      status: { column: 'status', type: 'text' },
      notes: { column: 'notes', type: 'text' },
      openingReference: { column: 'opening_reference', type: 'text' },
      closingNotes: { column: 'closing_notes', type: 'text' },
      closingCountedCash: { column: 'closing_counted_cash', type: 'number' },
      expectedCash: { column: 'expected_cash', type: 'number' },
      variance: { column: 'variance', type: 'number' },
      closedById: { column: 'closed_by_id', type: 'text' },
      closedByName: { column: 'closed_by_name', type: 'text' },
      openedAt: { column: 'opened_at', type: 'timestamp' },
      closedAt: { column: 'closed_at', type: 'timestamp' },
      updatedAt: { column: 'updated_at', type: 'timestamp' }
    },
    readOnly: true,
    serialize: (row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      branchId: row.branch_id,
      openingFloat: Number(row.opening_float ?? 0),
      status: row.status,
      notes: row.notes,
      openingReference: row.opening_reference,
      closingNotes: row.closing_notes,
      closingCountedCash: row.closing_counted_cash === null || row.closing_counted_cash === undefined ? undefined : Number(row.closing_counted_cash),
      expectedCash: row.expected_cash === null || row.expected_cash === undefined ? undefined : Number(row.expected_cash),
      variance: row.variance === null || row.variance === undefined ? undefined : Number(row.variance),
      closedById: row.closed_by_id,
      closedByName: row.closed_by_name,
      openedAt: toIsoString(row.opened_at),
      closedAt: toNullableIsoString(row.closed_at),
      updatedAt: toIsoString(row.updated_at)
    })
  },
  cash_movements: {
    table: 'cash_movements',
    readPermissions: ['shifts', 'reports', 'pos'],
    fieldMap: {
      shiftId: { column: 'shift_id', type: 'text' },
      branchId: { column: 'branch_id', type: 'text' },
      userId: { column: 'user_id', type: 'text' },
      userName: { column: 'user_name', type: 'text' },
      type: { column: 'type', type: 'text' },
      amount: { column: 'amount', type: 'number' },
      reason: { column: 'reason', type: 'text' },
      reference: { column: 'reference', type: 'text' },
      timestamp: { column: 'created_at', type: 'timestamp' }
    },
    readOnly: true,
    serialize: (row) => ({
      id: row.id,
      shiftId: row.shift_id,
      branchId: row.branch_id,
      userId: row.user_id,
      userName: row.user_name,
      type: row.type,
      amount: Number(row.amount ?? 0),
      reason: row.reason,
      reference: row.reference,
      timestamp: toIsoString(row.created_at)
    })
  }
});

const genericCollections: Record<string, { readPermissions: string[]; writePermissions: string[]; allowDelete?: boolean }> = {
  categories: { readPermissions: ['categories', 'products', 'purchase-orders'], writePermissions: ['products', 'categories'], allowDelete: true },
  suppliers: { readPermissions: ['suppliers', 'inventory', 'purchase-orders'], writePermissions: ['inventory', 'suppliers', 'purchase-orders'], allowDelete: true },
  expenses: { readPermissions: ['expenses', 'reports'], writePermissions: ['expenses'], allowDelete: true },
  expense_categories: { readPermissions: ['expenses'], writePermissions: ['expenses'], allowDelete: true },
  purchase_orders: { readPermissions: ['purchase-orders', 'suppliers', 'inventory'], writePermissions: ['purchase-orders'], allowDelete: true },
  label_templates: { readPermissions: ['labels'], writePermissions: ['labels'], allowDelete: true },
  label_history: { readPermissions: ['labels'], writePermissions: ['labels'], allowDelete: false }
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const user = await getSessionUser(req, res);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const body = await readJsonBody<DataRequestBody>(req);

    if (body.mode === 'doc') {
      const doc = await readDocument(body.path, user);
      return res.status(200).json(doc);
    }

    if (body.mode === 'query') {
      const docs = await readQuery(body.source, body.constraints || [], user);
      return res.status(200).json({ docs });
    }

    const result = await mutateData(body, user);
    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode =
      message.includes('Permission denied')
        ? 403
        : message.includes('not found')
          ? 404
          : message.includes('invalid') || message.includes('Unsupported')
            ? 400
            : 500;
    return res.status(statusCode).json({ error: message });
  }
}

type SessionUserLike = {
  uid: string;
  role: 'superadmin' | 'admin' | 'cashier';
  permissions: string[];
};

function ensureAnyPermission(user: SessionUserLike, permissionIds: string[]) {
  if (!permissionIds.some((permissionId) => hasPermission(user as any, permissionId))) {
    throw new Error('Permission denied');
  }
}

function parsePath(path: string) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 2) {
    return { type: 'topLevelDoc' as const, collection: parts[0], id: parts[1] };
  }
  if (parts.length === 4 && parts[0] === 'sales' && parts[2] === 'items') {
    return { type: 'saleItemDoc' as const, saleId: parts[1], itemId: parts[3] };
  }
  throw new Error(`Unsupported document path: ${path}`);
}

function parseCollectionPath(path: string) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 1) {
    return { type: 'topLevelCollection' as const, collection: parts[0] };
  }
  if (parts.length === 3 && parts[0] === 'sales' && parts[2] === 'items') {
    return { type: 'saleItemsCollection' as const, saleId: parts[1] };
  }
  throw new Error(`Unsupported collection path: ${path}`);
}

async function readDocument(path: string, user: SessionUserLike, client?: PoolClient) {
  const target = parsePath(path);

  if (target.type === 'saleItemDoc') {
    ensureAnyPermission(user, ['pos', 'sales-history', 'reports']);
    const row = await queryOne<Record<string, unknown>>(
      'SELECT * FROM sale_items WHERE id = $1 AND sale_id = $2 LIMIT 1',
      [target.itemId, target.saleId],
      client
    );
    if (!row) {
      return { id: target.itemId, exists: false, data: null };
    }
    return { id: target.itemId, exists: true, data: serializeSaleItem(row) };
  }

  if (explicitCollections[target.collection]) {
    const config = explicitCollections[target.collection];
    if (!(target.collection === 'users' && target.id === user.uid)) {
      ensureAnyPermission(user, config.readPermissions);
    }
    const row = await queryOne<Record<string, unknown>>(
      `SELECT * FROM ${config.table} WHERE id = $1 LIMIT 1`,
      [target.id],
      client
    );
    if (!row) {
      return { id: target.id, exists: false, data: null };
    }
    return { id: target.id, exists: true, data: config.serialize(row) };
  }

  const generic = genericCollections[target.collection];
  if (!generic) {
    throw new Error(`Unsupported collection: ${target.collection}`);
  }
  ensureAnyPermission(user, generic.readPermissions);

  const row = await queryOne<Record<string, unknown>>(
    `
    SELECT id, payload, created_at, updated_at
    FROM app_documents
    WHERE collection_name = $1 AND id = $2
    LIMIT 1
    `,
    [target.collection, target.id],
    client
  );

  if (!row) {
    return { id: target.id, exists: false, data: null };
  }

  return { id: target.id, exists: true, data: mergeGenericPayload(row) };
}

async function readQuery(
  source: { kind: 'collection'; path: string } | { kind: 'collectionGroup'; collectionId: string },
  constraints: QueryConstraint[],
  user: SessionUserLike
) {
  if (source.kind === 'collectionGroup') {
    if (source.collectionId !== 'items') {
      throw new Error(`Unsupported collection group: ${source.collectionId}`);
    }
    ensureAnyPermission(user, ['pos', 'sales-history', 'reports']);
    const queryParts = buildExplicitQuery(
      {
        table: 'sale_items',
        fieldMap: {
          saleId: { column: 'sale_id', type: 'text' },
          productId: { column: 'product_id', type: 'text' },
          productName: { column: 'product_name', type: 'text' },
          barcode: { column: 'barcode', type: 'text' },
          quantity: { column: 'quantity', type: 'integer' },
          unitPrice: { column: 'unit_price', type: 'number' },
          totalPrice: { column: 'total_price', type: 'number' },
          name: { column: 'display_name', type: 'text' },
          sellingPrice: { column: 'selling_price', type: 'number' },
          isRefunded: { column: 'is_refunded', type: 'boolean' },
          status: { column: 'status', type: 'text' },
          refundedAt: { column: 'refunded_at', type: 'timestamp' },
          refundedBy: { column: 'refunded_by', type: 'text' },
          timestamp: { column: 'created_at', type: 'timestamp' }
        }
      },
      constraints,
      []
    );
    const rows = await queryRows<Record<string, unknown>>(queryParts.text, queryParts.params);
    return rows.map((row) => ({ id: row.id, data: serializeSaleItem(row) }));
  }

  const collectionTarget = parseCollectionPath(source.path);
  if (collectionTarget.type === 'saleItemsCollection') {
    ensureAnyPermission(user, ['pos', 'sales-history', 'reports']);
    const queryParts = buildExplicitQuery(
      {
        table: 'sale_items',
        fieldMap: {
          saleId: { column: 'sale_id', type: 'text' },
          productId: { column: 'product_id', type: 'text' },
          productName: { column: 'product_name', type: 'text' },
          barcode: { column: 'barcode', type: 'text' },
          quantity: { column: 'quantity', type: 'integer' },
          unitPrice: { column: 'unit_price', type: 'number' },
          totalPrice: { column: 'total_price', type: 'number' },
          name: { column: 'display_name', type: 'text' },
          sellingPrice: { column: 'selling_price', type: 'number' },
          isRefunded: { column: 'is_refunded', type: 'boolean' },
          status: { column: 'status', type: 'text' },
          refundedAt: { column: 'refunded_at', type: 'timestamp' },
          refundedBy: { column: 'refunded_by', type: 'text' },
          timestamp: { column: 'created_at', type: 'timestamp' }
        }
      },
      constraints,
      [{ sql: 'sale_id = $1', params: [collectionTarget.saleId] }]
    );
    const rows = await queryRows<Record<string, unknown>>(queryParts.text, queryParts.params);
    return rows.map((row) => ({ id: row.id, data: serializeSaleItem(row) }));
  }

  const collection = collectionTarget.collection;
  if (explicitCollections[collection]) {
    const config = explicitCollections[collection];
    ensureAnyPermission(user, config.readPermissions);
    const queryParts = buildExplicitQuery(config, constraints, []);
    const rows = await queryRows<Record<string, unknown>>(queryParts.text, queryParts.params);
    return rows.map((row) => ({ id: row.id, data: config.serialize(row) }));
  }

  const generic = genericCollections[collection];
  if (!generic) {
    throw new Error(`Unsupported collection: ${collection}`);
  }
  ensureAnyPermission(user, generic.readPermissions);

  const queryParts = buildGenericQuery(collection, constraints);
  const rows = await queryRows<Record<string, unknown>>(queryParts.text, queryParts.params);
  return rows.map((row) => ({ id: row.id, data: mergeGenericPayload(row) }));
}

async function mutateData(body: Extract<DataRequestBody, { mode: 'write' }>, user: SessionUserLike) {
  if (body.action === 'batch') {
    const operations = body.operations || [];
    await withTransaction(async (client) => {
      for (const operation of operations) {
        await applyWriteOperation(operation, user, client);
      }
    });
    return { ok: true };
  }

  return applyWriteOperation(
    {
      action: body.action,
      path: body.path,
      collectionPath: body.collectionPath,
      data: body.data
    },
    user
  );
}

async function applyWriteOperation(
  operation: {
    action: 'set' | 'add' | 'update' | 'delete';
    path?: string;
    collectionPath?: string;
    data?: Record<string, unknown>;
  },
  user: SessionUserLike,
  client?: PoolClient
) {
  if (operation.action === 'delete') {
    if (!operation.path) {
      throw new Error('Path is required for delete');
    }
    return deleteDocument(operation.path, user, client);
  }

  if (operation.action === 'add') {
    if (!operation.collectionPath) {
      throw new Error('collectionPath is required for add');
    }
    return addDocument(operation.collectionPath, operation.data || {}, user, client);
  }

  if (!operation.path) {
    throw new Error('Path is required');
  }

  if (operation.action === 'set') {
    return setDocument(operation.path, operation.data || {}, user, client);
  }

  return updateDocument(operation.path, operation.data || {}, user, client);
}

async function addDocument(collectionPath: string, data: Record<string, unknown>, user: SessionUserLike, client?: PoolClient) {
  const target = parseCollectionPath(collectionPath);
  if (target.type !== 'topLevelCollection') {
    throw new Error(`Unsupported add collection path: ${collectionPath}`);
  }

  const collection = target.collection;
  if (explicitCollections[collection]) {
    const config = explicitCollections[collection];
    ensureAnyPermission(user, config.writePermissions || []);
    if (!config.allowCreate || config.readOnly) {
      throw new Error(`Unsupported add for collection: ${collection}`);
    }

    const id = collection === 'settings' ? 'system' : createId(collection.slice(0, 3));
    const insert = buildExplicitInsert(config, id, data);
    await queryResult(insert.text, insert.params, client);
    return { id };
  }

  const generic = genericCollections[collection];
  if (!generic) {
    throw new Error(`Unsupported collection: ${collection}`);
  }
  ensureAnyPermission(user, generic.writePermissions);

  const id = createId(collection.slice(0, 3));
  await queryResult(
    `
    INSERT INTO app_documents (collection_name, id, payload, created_at, updated_at)
    VALUES ($1, $2, $3::jsonb, NOW(), NOW())
    `,
    [collection, id, JSON.stringify(data)],
    client
  );
  return { id };
}

async function setDocument(path: string, data: Record<string, unknown>, user: SessionUserLike, client?: PoolClient) {
  const target = parsePath(path);
  if (target.type !== 'topLevelDoc') {
    throw new Error(`Unsupported set path: ${path}`);
  }

  const collection = target.collection;
  if (explicitCollections[collection]) {
    const config = explicitCollections[collection];
    ensureAnyPermission(user, config.writePermissions || []);
    if (config.readOnly) {
      throw new Error(`Unsupported set for collection: ${collection}`);
    }
    const insert = buildExplicitInsert(config, target.id, data);
    await queryResult(insert.text, insert.params, client);
    return { ok: true };
  }

  const generic = genericCollections[collection];
  if (!generic) {
    throw new Error(`Unsupported collection: ${collection}`);
  }
  ensureAnyPermission(user, generic.writePermissions);
  await queryResult(
    `
    INSERT INTO app_documents (collection_name, id, payload, created_at, updated_at)
    VALUES ($1, $2, $3::jsonb, NOW(), NOW())
    ON CONFLICT (collection_name, id)
    DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
    `,
    [collection, target.id, JSON.stringify(data)],
    client
  );
  return { ok: true };
}

async function updateDocument(path: string, data: Record<string, unknown>, user: SessionUserLike, client?: PoolClient) {
  const target = parsePath(path);
  if (target.type !== 'topLevelDoc') {
    throw new Error(`Unsupported update path: ${path}`);
  }

  const collection = target.collection;
  if (explicitCollections[collection]) {
    const config = explicitCollections[collection];
    ensureAnyPermission(user, config.writePermissions || []);
    if (config.readOnly) {
      throw new Error(`Unsupported update for collection: ${collection}`);
    }
    const update = buildExplicitUpdate(config, target.id, data);
    await queryResult(update.text, update.params, client);
    return { ok: true };
  }

  const generic = genericCollections[collection];
  if (!generic) {
    throw new Error(`Unsupported collection: ${collection}`);
  }
  ensureAnyPermission(user, generic.writePermissions);

  const existing = await queryOne<Record<string, unknown>>(
    'SELECT payload FROM app_documents WHERE collection_name = $1 AND id = $2 LIMIT 1',
    [collection, target.id],
    client
  );
  if (!existing) {
    throw new Error(`Document not found: ${path}`);
  }

  const payload = isRecord(existing.payload) ? { ...existing.payload, ...data } : data;
  await queryResult(
    `
    UPDATE app_documents
    SET payload = $3::jsonb, updated_at = NOW()
    WHERE collection_name = $1 AND id = $2
    `,
    [collection, target.id, JSON.stringify(payload)],
    client
  );
  return { ok: true };
}

async function deleteDocument(path: string, user: SessionUserLike, client?: PoolClient) {
  const target = parsePath(path);
  if (target.type !== 'topLevelDoc') {
    throw new Error(`Unsupported delete path: ${path}`);
  }

  const collection = target.collection;
  if (explicitCollections[collection]) {
    const config = explicitCollections[collection];
    ensureAnyPermission(user, config.writePermissions || []);
    if (!config.allowDelete) {
      throw new Error(`Unsupported delete for collection: ${collection}`);
    }
    await queryResult(`DELETE FROM ${config.table} WHERE id = $1`, [target.id], client);
    return { ok: true };
  }

  const generic = genericCollections[collection];
  if (!generic) {
    throw new Error(`Unsupported collection: ${collection}`);
  }
  ensureAnyPermission(user, generic.writePermissions);
  if (generic.allowDelete === false) {
    throw new Error(`Unsupported delete for collection: ${collection}`);
  }
  await queryResult('DELETE FROM app_documents WHERE collection_name = $1 AND id = $2', [collection, target.id], client);
  return { ok: true };
}

function buildExplicitQuery(
  config: Pick<ExplicitConfig, 'table' | 'fieldMap'>,
  constraints: QueryConstraint[],
  baseClauses: Array<{ sql: string; params: unknown[] }>
) {
  const whereClauses = [...baseClauses];
  let orderClause = ' ORDER BY id ASC';
  let limitClause = '';

  for (const constraint of constraints) {
    if (constraint.type === 'where') {
      const descriptor = config.fieldMap[constraint.field];
      if (!descriptor || constraint.op !== '==') {
        throw new Error(`Unsupported query constraint for field: ${constraint.field}`);
      }
      whereClauses.push({
        sql: `${descriptor.column} = $${whereClauses.flatMap((entry) => entry.params).length + 1}`,
        params: [transformInputValue(descriptor.type, constraint.value)]
      });
    } else if (constraint.type === 'orderBy') {
      const descriptor = config.fieldMap[constraint.field];
      if (!descriptor) {
        throw new Error(`Unsupported orderBy field: ${constraint.field}`);
      }
      const direction = constraint.direction === 'asc' ? 'ASC' : 'DESC';
      orderClause = ` ORDER BY ${descriptor.column} ${direction}`;
    } else if (constraint.type === 'limit') {
      limitClause = ` LIMIT ${Math.max(0, constraint.count)}`;
    }
  }

  const params: unknown[] = [];
  const clauses: string[] = [];
  for (const clause of whereClauses) {
    let sql = clause.sql;
    for (const value of clause.params) {
      params.push(value);
      sql = sql.replace(/\$\d+/, `$${params.length}`);
    }
    clauses.push(sql);
  }

  const whereSql = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  return {
    text: `SELECT * FROM ${config.table}${whereSql}${orderClause}${limitClause}`,
    params
  };
}

function buildGenericQuery(collection: string, constraints: QueryConstraint[]) {
  const params: unknown[] = [collection];
  const clauses = ['collection_name = $1'];
  let orderClause = ' ORDER BY updated_at DESC';
  let limitClause = '';

  for (const constraint of constraints) {
    if (constraint.type === 'where') {
      params.push(String(constraint.value ?? ''));
      clauses.push(`payload->>'${constraint.field}' = $${params.length}`);
    } else if (constraint.type === 'orderBy') {
      const direction = constraint.direction === 'asc' ? 'ASC' : 'DESC';
      const expression = genericFieldExpression(constraint.field);
      orderClause = ` ORDER BY ${expression} ${direction}`;
    } else if (constraint.type === 'limit') {
      limitClause = ` LIMIT ${Math.max(0, constraint.count)}`;
    }
  }

  return {
    text: `
      SELECT id, payload, created_at, updated_at
      FROM app_documents
      WHERE ${clauses.join(' AND ')}
      ${orderClause}
      ${limitClause}
    `,
    params
  };
}

function buildExplicitInsert(config: ExplicitConfig, id: string, data: Record<string, unknown>) {
  const writableFields = config.writableFields || [];
  const columns = ['id'];
  const values: unknown[] = [id];
  const placeholders = ['$1'];
  let index = 2;

  for (const field of writableFields) {
    const descriptor = config.fieldMap[field];
    if (!descriptor) {
      continue;
    }
    const rawValue = data[field];
    if (rawValue === undefined) {
      continue;
    }
    columns.push(descriptor.column);
    values.push(transformInputValue(descriptor.type, rawValue));
    placeholders.push(`$${index}`);
    index += 1;
  }

  if (config.fieldMap.updatedAt && !columns.includes(config.fieldMap.updatedAt.column)) {
    columns.push(config.fieldMap.updatedAt.column);
    values.push(new Date().toISOString());
    placeholders.push(`$${index}`);
    index += 1;
  }

  const updateAssignments = columns
    .filter((column) => column !== 'id')
    .map((column) => `${column} = EXCLUDED.${column}`);

  return {
    text: `
      INSERT INTO ${config.table} (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id)
      DO UPDATE SET ${updateAssignments.join(', ')}
    `,
    params: values
  };
}

function buildExplicitUpdate(config: ExplicitConfig, id: string, data: Record<string, unknown>) {
  const writableFields = config.writableFields || [];
  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const field of writableFields) {
    const descriptor = config.fieldMap[field];
    if (!descriptor || !(field in data)) {
      continue;
    }
    params.push(transformInputValue(descriptor.type, data[field]));
    assignments.push(`${descriptor.column} = $${params.length}`);
  }

  if (config.fieldMap.updatedAt) {
    params.push(new Date().toISOString());
    assignments.push(`${config.fieldMap.updatedAt.column} = $${params.length}`);
  }

  if (assignments.length === 0) {
    throw new Error('No valid fields were provided for update');
  }

  params.push(id);
  return {
    text: `UPDATE ${config.table} SET ${assignments.join(', ')} WHERE id = $${params.length}`,
    params
  };
}

function genericFieldExpression(field: string) {
  if (field === 'createdAt' || field === 'updatedAt' || field === 'timestamp' || field === 'date' || field.endsWith('At')) {
    return `NULLIF(payload->>'${field}', '')::timestamptz`;
  }
  if (field.toLowerCase().includes('amount') || field.toLowerCase().includes('price') || field.toLowerCase().includes('quantity')) {
    return `COALESCE((payload->>'${field}')::numeric, 0)`;
  }
  return `payload->>'${field}'`;
}

function transformInputValue(type: FieldType, value: unknown) {
  if (value === null) {
    return null;
  }
  switch (type) {
    case 'number':
      return Number(value ?? 0);
    case 'integer':
      return Math.trunc(Number(value ?? 0));
    case 'boolean':
      return Boolean(value);
    case 'json':
      return JSON.stringify(value ?? []);
    case 'timestamp':
      return value ? new Date(String(value)).toISOString() : null;
    default:
      return value === undefined ? null : String(value);
  }
}

function serializeSaleItem(row: Record<string, unknown>) {
  return {
    id: row.id,
    saleId: row.sale_id,
    productId: row.product_id,
    productName: row.product_name,
    barcode: row.barcode,
    quantity: Number(row.quantity ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    totalPrice: Number(row.total_price ?? 0),
    name: row.display_name,
    sellingPrice: row.selling_price === null || row.selling_price === undefined ? undefined : Number(row.selling_price),
    isRefunded: Boolean(row.is_refunded),
    status: row.status,
    refundedAt: toNullableIsoString(row.refunded_at),
    refundedBy: row.refunded_by,
    timestamp: toIsoString(row.created_at)
  };
}

function mergeGenericPayload(row: Record<string, unknown>) {
  const payload = isRecord(row.payload) ? row.payload : {};
  return {
    id: row.id,
    ...payload
  };
}

function normalizeJsonArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return normalizeJsonArray(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

function toIsoString(value: unknown) {
  return value ? new Date(String(value)).toISOString() : new Date(0).toISOString();
}

function toNullableIsoString(value: unknown) {
  return value ? new Date(String(value)).toISOString() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
