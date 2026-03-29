async function requestJson<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({} as { error?: string }));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}`);
  }
  return payload as T;
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
  });
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
  });
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
  });
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
  });
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
  });
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
  });
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
  });
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
  });
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
  });
}

export async function receivePurchaseOrder(orderId: string) {
  return requestJson<{ ok: true; orderId: string }>('/api/transactions/purchase-order-receive', {
    method: 'POST',
    body: JSON.stringify({ orderId })
  });
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
  });
}

export async function changePassword(input: {
  currentPassword?: string;
  newPassword: string;
  targetUserId?: string;
}) {
  return requestJson<{ ok: true }>('/api/account/password', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function dataApi<T>(body: Record<string, unknown>) {
  return requestJson<T>('/api/data', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}
