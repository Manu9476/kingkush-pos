import type { PoolClient } from '@neondatabase/serverless';

import type { SessionUser } from './auth.js';
import { createId } from './db.js';

export type ShiftSummary = {
  shiftId: string;
  branchId: string | null;
  openingFloat: number;
  cashSales: number;
  cashCreditPayments: number;
  manualCashIn: number;
  manualCashOut: number;
  expectedCash: number;
  countedCash: number | null;
  variance: number | null;
};

export async function resolveBranchId(client: PoolClient, user: Pick<SessionUser, 'uid' | 'branchId'>) {
  if (user.branchId) {
    return user.branchId;
  }

  const userResult = await client.query<{ branch_id: string | null }>(
    'SELECT branch_id FROM users WHERE id = $1 LIMIT 1',
    [user.uid]
  );
  const userBranchId = userResult.rows[0]?.branch_id;
  if (userBranchId) {
    return userBranchId;
  }

  const settingsResult = await client.query<{ default_branch_id: string | null }>(
    'SELECT default_branch_id FROM system_settings WHERE id = $1 LIMIT 1',
    ['system']
  );
  return settingsResult.rows[0]?.default_branch_id || 'branch_main';
}

export async function getOpenShift(client: PoolClient, userId: string) {
  const shiftResult = await client.query<{
    id: string;
    branch_id: string | null;
    opening_float: string;
    status: string;
    opened_at: string;
    notes: string | null;
    opening_reference: string | null;
    closing_counted_cash: string | null;
    expected_cash: string | null;
    variance: string | null;
  }>(
    `
    SELECT
      id,
      branch_id,
      opening_float,
      status,
      opened_at,
      notes,
      opening_reference,
      closing_counted_cash,
      expected_cash,
      variance
    FROM cash_shifts
    WHERE user_id = $1 AND status = 'open'
    ORDER BY opened_at DESC
    LIMIT 1
    FOR UPDATE
    `,
    [userId]
  );

  return shiftResult.rows[0] || null;
}

export async function calculateShiftSummary(client: PoolClient, shiftId: string): Promise<ShiftSummary> {
  const shiftResult = await client.query<{
    id: string;
    branch_id: string | null;
    opening_float: string;
    closing_counted_cash: string | null;
  }>(
    `
    SELECT id, branch_id, opening_float, closing_counted_cash
    FROM cash_shifts
    WHERE id = $1
    LIMIT 1
    `,
    [shiftId]
  );
  const shift = shiftResult.rows[0];
  if (!shift) {
    throw new Error('Shift not found');
  }

  const salesResult = await client.query<{ total: string }>(
    `
    SELECT COALESCE(SUM(GREATEST(amount_paid - balance, 0)), 0)::text AS total
    FROM sales
    WHERE shift_id = $1
      AND LOWER(COALESCE(tender_method, payment_method)) = 'cash'
    `,
    [shiftId]
  );

  const creditPaymentsResult = await client.query<{ total: string }>(
    `
    SELECT COALESCE(SUM(amount_paid), 0)::text AS total
    FROM credit_payments
    WHERE shift_id = $1
      AND LOWER(payment_method) = 'cash'
    `,
    [shiftId]
  );

  const movementsResult = await client.query<{ type: string; total: string }>(
    `
    SELECT type, COALESCE(SUM(amount), 0)::text AS total
    FROM cash_movements
    WHERE shift_id = $1
    GROUP BY type
    `,
    [shiftId]
  );

  const totalsByType = new Map(movementsResult.rows.map((row) => [row.type, Number(row.total ?? 0)]));
  const openingFloat = Number(shift.opening_float ?? 0);
  const cashSales = Number(salesResult.rows[0]?.total ?? 0);
  const cashCreditPayments = Number(creditPaymentsResult.rows[0]?.total ?? 0);
  const manualCashIn =
    (totalsByType.get('cash-in') || 0) +
    (totalsByType.get('float-add') || 0);
  const manualCashOut =
    (totalsByType.get('cash-out') || 0) +
    (totalsByType.get('safe-drop') || 0) +
    (totalsByType.get('refund') || 0) +
    (totalsByType.get('expense') || 0);
  const expectedCash = openingFloat + cashSales + cashCreditPayments + manualCashIn - manualCashOut;
  const countedCash = shift.closing_counted_cash === null ? null : Number(shift.closing_counted_cash);

  return {
    shiftId: shift.id,
    branchId: shift.branch_id,
    openingFloat,
    cashSales,
    cashCreditPayments,
    manualCashIn,
    manualCashOut,
    expectedCash,
    countedCash,
    variance: countedCash === null ? null : countedCash - expectedCash
  };
}

export async function insertCashMovement(
  client: PoolClient,
  input: {
    shiftId: string;
    branchId: string | null;
    userId: string;
    userName: string;
    type: 'cash-in' | 'cash-out' | 'float-add' | 'safe-drop' | 'refund' | 'expense';
    amount: number;
    reason: string;
    reference?: string | null;
    createdAt?: string;
  }
) {
  await client.query(
    `
    INSERT INTO cash_movements (
      id,
      shift_id,
      branch_id,
      user_id,
      user_name,
      type,
      amount,
      reason,
      reference,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
    `,
    [
      createId('cashmv'),
      input.shiftId,
      input.branchId,
      input.userId,
      input.userName,
      input.type,
      input.amount,
      input.reason,
      input.reference || null,
      input.createdAt || new Date().toISOString()
    ]
  );
}
