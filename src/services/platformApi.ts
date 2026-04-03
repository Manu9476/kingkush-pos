const REQUEST_TIMEOUT_MS = 30000;
const REQUEST_TIMEOUT_MESSAGE = 'The server took too long to respond. Please retry.';
const PROTECTED_PREVIEW_MESSAGE =
  'This Vercel preview deployment is protected. Sign into the preview or use the public production URL.';
const UNEXPECTED_HTML_MESSAGE =
  'The server returned an unexpected page instead of API data. Please refresh and try again.';

export type SystemIssueReport = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  summary: string;
  fix: string;
  componentId?: string;
  route?: string;
  file?: string;
};

export type SystemModuleHealthReport = {
  id: string;
  label: string;
  route: string;
  permission: string;
  file: string;
  functionality: string;
  status: 'ok' | 'warning' | 'error';
  summary: string;
  fix?: string;
  issueCount: number;
};

export type SystemComponentCatalogEntry = {
  id: string;
  label: string;
  route: string;
  permission: string;
  file: string;
  functionality: string;
};

export type SystemHistoryScope = {
  id: 'sales' | 'cash-shifts' | 'inventory' | 'expenses' | 'audit' | 'purchase-orders' | 'label-history';
  label: string;
  description: string;
  warning: string;
  recordCount: number;
};

export type SystemReceiptKind = 'sale' | 'refund' | 'credit-payment' | 'expense' | 'cash-shift';

export type SystemReceiptSearchResult = {
  id: string;
  kind: SystemReceiptKind;
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

export type SystemStatusReport = {
  generatedAt: string;
  issueSummary: {
    critical: number;
    warning: number;
    info: number;
  };
  services: Array<{
    id: string;
    label: string;
    status: 'ok' | 'warning' | 'error';
    message: string;
  }>;
  counts: Record<string, number>;
  issues: SystemIssueReport[];
  moduleHealth: SystemModuleHealthReport[];
  components: SystemComponentCatalogEntry[];
  historyScopes: SystemHistoryScope[];
  receiptAppearance: {
    brandColor: string;
    paperWidthMm: number;
    fontSizePx: number;
    header: string;
    footer: string;
  };
};

export type SystemReceiptSearchResponse = {
  filters: {
    kind: 'all' | SystemReceiptKind;
    query: string;
    dateFrom: string | null;
    dateTo: string | null;
    limit: number;
  };
  receipts: SystemReceiptSearchResult[];
};

function emitDataMutation(url: string, method: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent('kingkush:data-mutated', {
      detail: { url, method }
    })
  );
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function looksLikeHtml(contentType: string, body: string) {
  const normalizedBody = body.trim().toLowerCase();
  return (
    contentType.includes('text/html') ||
    normalizedBody.startsWith('<!doctype html') ||
    normalizedBody.startsWith('<html')
  );
}

function looksLikeProtectedPreview(contentType: string, body: string) {
  const normalizedBody = body.toLowerCase();
  return (
    looksLikeHtml(contentType, body) &&
    (normalizedBody.includes('vercel authentication') ||
      normalizedBody.includes('this page requires vercel authentication') ||
      normalizedBody.includes('sso-api') ||
      normalizedBody.includes('authentication required'))
  );
}

async function readResponsePayload(response: Response) {
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  const rawBody = await response.text();
  let payload: { error?: string } | Record<string, unknown> = {};

  if (rawBody.trim() && !looksLikeHtml(contentType, rawBody)) {
    try {
      payload = JSON.parse(rawBody) as { error?: string } | Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  return { contentType, rawBody, payload };
}

async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  config: { mutatesData?: boolean; timeoutMs?: number } = {}
) {
  const controller = new AbortController();
  const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetch(url, {
      credentials: 'include',
      ...options,
      headers,
      signal: controller.signal
    });

    const { contentType, rawBody, payload } = await readResponsePayload(response);

    if (looksLikeProtectedPreview(contentType, rawBody)) {
      throw new Error(PROTECTED_PREVIEW_MESSAGE);
    }

    if (!response.ok) {
      throw new Error(
        typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}`
      );
    }

    if (rawBody.trim() && looksLikeHtml(contentType, rawBody)) {
      throw new Error(UNEXPECTED_HTML_MESSAGE);
    }

    const method = (options.method || 'GET').toUpperCase();
    if (config.mutatesData && method !== 'GET') {
      emitDataMutation(url, method);
    }

    return payload as T;
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(REQUEST_TIMEOUT_MESSAGE);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function getSetupStatus() {
  return requestJson<{ needsBootstrap: boolean }>('/api/setup/status', {
    method: 'GET',
    headers: {}
  });
}

export async function bootstrapSuperadmin(input: {
  username: string;
  password: string;
  displayName: string;
}) {
  return requestJson<{ user: unknown }>('/api/setup/bootstrap', {
    method: 'POST',
    body: JSON.stringify(input)
  }, { mutatesData: true });
}

export async function createSale(input: {
  items: Array<{ id: string; name: string; barcode: string; quantity: number; sellingPrice: number }>;
  paymentMethod: 'cash' | 'mpesa' | 'card' | 'credit';
  tenderMethod?: 'cash' | 'mpesa' | 'card' | 'credit';
  amountPaid: number;
  customerId?: string;
  customerName?: string;
  reference?: string;
}) {
  return requestJson<{
    sale: any;
  }>('/api/transactions/sale', {
    method: 'POST',
    body: JSON.stringify(input)
  }, { mutatesData: true, timeoutMs: 45000 });
}

export async function refundSale(input: {
  saleId: string;
  refundReason: string;
  itemId?: string;
}) {
  return requestJson<{
    ok: true;
    refundAmount: number;
    fullyRefunded: boolean;
    sale: any;
  }>('/api/transactions/refund', {
    method: 'POST',
    body: JSON.stringify(input)
  }, { mutatesData: true });
}

export async function processInventoryMovement(input: {
  actionType: 'receiving' | 'stock-in' | 'adjustment';
  productId?: string;
  barcode?: string;
  quantity: number;
  supplierId?: string;
  unitCost?: number;
  reference?: string;
  reason?: string;
  notes?: string;
}) {
  return requestJson<{ ok: true; productId: string; resultingStock: number }>('/api/transactions/inventory', {
    method: 'POST',
    body: JSON.stringify(input)
  }, { mutatesData: true });
}

export async function getShiftStatus() {
  return requestJson<{
    shift: any | null;
    summary: any | null;
  }>('/api/transactions/shift', {
    method: 'GET',
    headers: {}
  });
}

export async function getShiftReport(shiftId: string) {
  return requestJson<any>(`/api/transactions/shift?shiftId=${encodeURIComponent(shiftId)}`, {
    method: 'GET',
    headers: {}
  });
}

export async function openShift(input: {
  openingFloat: number;
  notes?: string;
  openingReference?: string;
}) {
  return requestJson<{
    shift: any;
    summary: any;
  }>('/api/transactions/shift', {
    method: 'POST',
    body: JSON.stringify({
      action: 'open',
      ...input
    })
  }, { mutatesData: true });
}

export async function closeShift(input: {
  closingCountedCash: number;
  notes?: string;
}) {
  return requestJson<{
    shift: any;
    summary: any;
  }>('/api/transactions/shift', {
    method: 'POST',
    body: JSON.stringify({
      action: 'close',
      ...input
    })
  }, { mutatesData: true });
}

export async function recordCashMovement(input: {
  type: 'cash-in' | 'cash-out' | 'float-add' | 'safe-drop';
  amount: number;
  reason: string;
  reference?: string;
}) {
  return requestJson<{
    ok: true;
    shiftId: string;
    branchId?: string;
  }>('/api/transactions/cash-movement', {
    method: 'POST',
    body: JSON.stringify(input)
  }, { mutatesData: true });
}

export async function createExpense(input: {
  category: string;
  description: string;
  amount: number;
  paymentMethod: 'cash' | 'mpesa' | 'bank' | 'other';
  reference?: string;
}) {
  return requestJson<{
    expense: any;
  }>('/api/transactions/expense', {
    method: 'POST',
    body: JSON.stringify(input)
  }, { mutatesData: true });
}

export async function recordCreditPayment(input: {
  creditId: string;
  amountPaid: number;
  paymentMethod: string;
  reference?: string;
}) {
  return requestJson<{
    payment: any;
  }>('/api/transactions/credit-payment', {
    method: 'POST',
    body: JSON.stringify(input)
  }, { mutatesData: true });
}

export async function receivePurchaseOrder(orderId: string) {
  return requestJson<{ ok: true; orderId: string }>('/api/transactions/purchase-order-receive', {
    method: 'POST',
    body: JSON.stringify({ orderId })
  }, { mutatesData: true });
}

export async function createUserAccount(input: {
  username: string;
  password: string;
  displayName: string;
  branchId?: string;
  role: 'admin' | 'cashier';
  permissions: string[];
}) {
  return requestJson<{ user: Record<string, unknown> }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(input)
  }, { mutatesData: true });
}

export async function changePassword(input: {
  currentPassword?: string;
  newPassword: string;
  targetUserId?: string;
}) {
  return requestJson<{ ok: true }>('/api/account/password', {
    method: 'POST',
    body: JSON.stringify(input)
  }, { mutatesData: true });
}

export async function getSystemStatusReport() {
  return requestJson<SystemStatusReport>('/api/admin/system', {
    method: 'GET',
    headers: {}
  });
}

export async function purgeSystemHistory(input: {
  scope: 'sales' | 'cash-shifts' | 'inventory' | 'expenses' | 'audit' | 'purchase-orders' | 'label-history' | 'all';
}) {
  return requestJson<{
    ok: true;
    scope: string;
    deleted: Record<string, number>;
  }>('/api/admin/system', {
    method: 'POST',
    body: JSON.stringify(input)
  }, { mutatesData: true, timeoutMs: 45000 });
}

export async function searchSystemReceipts(input: {
  kind?: 'all' | SystemReceiptKind;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  params.set('view', 'receipts');
  if (input.kind) {
    params.set('kind', input.kind);
  }
  if (input.query) {
    params.set('query', input.query);
  }
  if (input.dateFrom) {
    params.set('dateFrom', input.dateFrom);
  }
  if (input.dateTo) {
    params.set('dateTo', input.dateTo);
  }
  if (input.limit) {
    params.set('limit', String(input.limit));
  }

  return requestJson<SystemReceiptSearchResponse>(`/api/admin/system?${params.toString()}`, {
    method: 'GET',
    headers: {}
  });
}

export async function deleteSystemReceipt(input: {
  kind: SystemReceiptKind;
  id: string;
}) {
  return requestJson<{
    ok: true;
    kind: SystemReceiptKind;
    id: string;
    deleted: Record<string, number>;
    message: string;
  }>('/api/admin/system', {
    method: 'POST',
    body: JSON.stringify({
      action: 'delete-receipt',
      ...input
    })
  }, { mutatesData: true, timeoutMs: 45000 });
}

export async function getProductMovementReport(input: {
  rangeStart: string;
  rangeEnd: string;
}) {
  return requestJson<{
    range: { start: string; end: string };
    rows: Array<{
      movementId: string;
      movementAt: string;
      productId: string;
      productName: string;
      sku: string;
      barcode: string;
      unitType: string;
      movementType: string;
      sourceType: string;
      sourceId: string;
      quantity: number;
      quantityIn: number;
      quantityOut: number;
      netQuantity: number;
      resultingStock: number | '';
      reason: string;
      reference: string;
      notes: string;
      unitCost: number | '';
      branchName: string;
      branchCode: string;
      supplierName: string;
      movedBy: string;
      customerName: string;
      paymentMethod: string;
      tenderMethod: string;
    }>;
    summary: Array<{
      productId: string;
      productName: string;
      sku: string;
      barcode: string;
      unitType: string;
      totalMoves: number;
      totalIn: number;
      totalOut: number;
      netQuantity: number;
      latestKnownStock: number | '';
    }>;
  }>('/api/reports', {
    method: 'POST',
    body: JSON.stringify({
      reportType: 'product-movement',
      ...input
    })
  });
}

export async function dataApi<T>(body: Record<string, unknown>) {
  return requestJson<T>('/api/data', {
    method: 'POST',
    body: JSON.stringify(body)
  }, {
    mutatesData: body.mode === 'write',
    timeoutMs: body.mode === 'write' ? 45000 : REQUEST_TIMEOUT_MS
  });
}
