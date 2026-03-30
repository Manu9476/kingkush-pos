import { requirePermission } from '../../lib/auth.js';
import { insertAuditLog } from '../../lib/audit.js';
import { createId, withTransaction } from '../../lib/db.js';
import { readJsonBody } from '../../lib/http.js';
import { calculateShiftSummary, getOpenShift, resolveBranchId } from '../../lib/operations.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const user = await requirePermission(req, res, ['shifts', 'pos']);
    if (!user) {
      return;
    }

    if (req.method === 'GET') {
      const requestedShiftId = readQueryValue(req.query?.shiftId);
      if (requestedShiftId) {
        const report = await withTransaction(async (client) => {
          const shiftResult = await client.query<{
            id: string;
            user_id: string;
            user_name: string;
            branch_id: string | null;
            branch_name: string | null;
            opening_float: string;
            status: 'open' | 'closed';
            notes: string | null;
            opening_reference: string | null;
            closing_notes: string | null;
            closing_counted_cash: string | null;
            expected_cash: string | null;
            variance: string | null;
            closed_by_id: string | null;
            closed_by_name: string | null;
            opened_at: string;
            closed_at: string | null;
            updated_at: string;
          }>(
            `
            SELECT
              s.id,
              s.user_id,
              s.user_name,
              s.branch_id,
              b.name AS branch_name,
              s.opening_float,
              s.status,
              s.notes,
              s.opening_reference,
              s.closing_notes,
              s.closing_counted_cash,
              s.expected_cash,
              s.variance,
              s.closed_by_id,
              s.closed_by_name,
              s.opened_at,
              s.closed_at,
              s.updated_at
            FROM cash_shifts s
            LEFT JOIN branches b ON b.id = s.branch_id
            WHERE s.id = $1
            LIMIT 1
            `,
            [requestedShiftId]
          );
          const shift = shiftResult.rows[0];
          if (!shift) {
            throw new Error('Shift not found');
          }

          const canViewReport =
            user.role === 'superadmin' ||
            user.role === 'admin' ||
            user.permissions.includes('reports') ||
            shift.user_id === user.uid;
          if (!canViewReport) {
            throw new Error('Permission denied');
          }

          const summary = await calculateShiftSummary(client, shift.id);
          const movementsResult = await client.query<{
            id: string;
            shift_id: string;
            branch_id: string | null;
            user_id: string | null;
            user_name: string;
            type: string;
            amount: string;
            reason: string;
            reference: string | null;
            created_at: string;
          }>(
            `
            SELECT id, shift_id, branch_id, user_id, user_name, type, amount, reason, reference, created_at
            FROM cash_movements
            WHERE shift_id = $1
            ORDER BY created_at ASC
            `,
            [shift.id]
          );
          const salesResult = await client.query<{
            id: string;
            total_amount: string;
            amount_paid: string;
            balance: string;
            outstanding_balance: string;
            payment_method: string;
            tender_method: string | null;
            customer_name: string | null;
            is_credit: boolean;
            is_refunded: boolean;
            refund_amount: string;
            sold_at: string;
          }>(
            `
            SELECT
              id,
              total_amount,
              amount_paid,
              balance,
              outstanding_balance,
              payment_method,
              tender_method,
              customer_name,
              is_credit,
              is_refunded,
              refund_amount,
              sold_at
            FROM sales
            WHERE shift_id = $1
            ORDER BY sold_at ASC
            `,
            [shift.id]
          );
          const creditPaymentsResult = await client.query<{
            id: string;
            sale_id: string;
            amount_paid: string;
            remaining_balance: string;
            payment_method: string;
            reference: string | null;
            cashier_name: string;
            paid_at: string;
          }>(
            `
            SELECT id, sale_id, amount_paid, remaining_balance, payment_method, reference, cashier_name, paid_at
            FROM credit_payments
            WHERE shift_id = $1
            ORDER BY paid_at ASC
            `,
            [shift.id]
          );

          const sales = salesResult.rows.map((row) => ({
            id: row.id,
            totalAmount: Number(row.total_amount ?? 0),
            amountPaid: Number(row.amount_paid ?? 0),
            collectedAmount: Math.max(0, Number(row.amount_paid ?? 0) - Number(row.balance ?? 0)),
            outstandingBalance: Number(row.outstanding_balance ?? 0),
            paymentMethod: row.payment_method,
            tenderMethod: row.tender_method,
            customerName: row.customer_name,
            isCredit: Boolean(row.is_credit),
            isRefunded: Boolean(row.is_refunded),
            refundAmount: Number(row.refund_amount ?? 0),
            soldAt: row.sold_at
          }));
          const creditPayments = creditPaymentsResult.rows.map((row) => ({
            id: row.id,
            saleId: row.sale_id,
            amountPaid: Number(row.amount_paid ?? 0),
            remainingBalance: Number(row.remaining_balance ?? 0),
            paymentMethod: row.payment_method,
            reference: row.reference,
            cashierName: row.cashier_name,
            paidAt: row.paid_at
          }));
          const movements = movementsResult.rows.map((row) => ({
            id: row.id,
            shiftId: row.shift_id,
            branchId: row.branch_id || undefined,
            userId: row.user_id || undefined,
            userName: row.user_name,
            type: row.type,
            amount: Number(row.amount ?? 0),
            reason: row.reason,
            reference: row.reference || undefined,
            timestamp: row.created_at
          }));

          return {
            generatedAt: new Date().toISOString(),
            shift: {
              id: shift.id,
              userId: shift.user_id,
              userName: shift.user_name,
              branchId: shift.branch_id || undefined,
              branchName: shift.branch_name || shift.branch_id || 'Unassigned branch',
              openingFloat: Number(shift.opening_float ?? 0),
              status: shift.status,
              notes: shift.notes || undefined,
              openingReference: shift.opening_reference || undefined,
              closingNotes: shift.closing_notes || undefined,
              closingCountedCash: shift.closing_counted_cash === null ? undefined : Number(shift.closing_counted_cash),
              expectedCash: shift.expected_cash === null ? undefined : Number(shift.expected_cash),
              variance: shift.variance === null ? undefined : Number(shift.variance),
              closedById: shift.closed_by_id || undefined,
              closedByName: shift.closed_by_name || undefined,
              openedAt: shift.opened_at,
              closedAt: shift.closed_at || undefined,
              updatedAt: shift.updated_at
            },
            summary,
            totals: {
              saleCount: sales.length,
              creditSaleCount: sales.filter((sale) => sale.isCredit || sale.outstandingBalance > 0).length,
              refundedSaleCount: sales.filter((sale) => sale.refundAmount > 0).length,
              totalSales: sales.reduce((sum, sale) => sum + sale.totalAmount, 0),
              totalCollected: sales.reduce((sum, sale) => sum + sale.collectedAmount, 0),
              totalOutstanding: sales.reduce((sum, sale) => sum + sale.outstandingBalance, 0),
              totalRefundAmount: sales.reduce((sum, sale) => sum + sale.refundAmount, 0),
              creditPaymentCount: creditPayments.length,
              totalCreditPayments: creditPayments.reduce((sum, payment) => sum + payment.amountPaid, 0)
            },
            movements,
            sales,
            creditPayments
          };
        });

        return res.status(200).json(report);
      }

      const payload = await withTransaction(async (client) => {
        const shift = await getOpenShift(client, user.uid, { forUpdate: false });
        if (!shift) {
          return { shift: null, summary: null };
        }

        const summary = await calculateShiftSummary(client, shift.id);
        return {
          shift: {
            id: shift.id,
            userId: user.uid,
            userName: user.displayName || user.username,
            branchId: shift.branch_id,
            openingFloat: Number(shift.opening_float ?? 0),
            status: shift.status,
            notes: shift.notes,
            openingReference: shift.opening_reference,
            closingCountedCash: shift.closing_counted_cash === null ? undefined : Number(shift.closing_counted_cash),
            expectedCash: shift.expected_cash === null ? undefined : Number(shift.expected_cash),
            variance: shift.variance === null ? undefined : Number(shift.variance),
            openedAt: shift.opened_at,
            updatedAt: shift.opened_at
          },
          summary
        };
      });

      return res.status(200).json(payload);
    }

    const body = await readJsonBody<{
      action?: 'open' | 'close';
      openingFloat?: number;
      closingCountedCash?: number;
      notes?: string;
      openingReference?: string;
    }>(req);

    const action = body.action || 'open';

    if (action === 'open') {
      const openingFloat = Number(body.openingFloat ?? 0);
      const notes = (body.notes || '').trim() || null;
      const openingReference = (body.openingReference || '').trim() || null;
      if (openingFloat < 0) {
        return res.status(400).json({ error: 'Opening float cannot be negative' });
      }

      const result = await withTransaction(async (client) => {
        const existingOpenShift = await getOpenShift(client, user.uid);
        if (existingOpenShift) {
          throw new Error('You already have an open cashier shift');
        }

        const branchId = await resolveBranchId(client, user);
        const shiftId = createId('shift');
        const openedAt = new Date().toISOString();

        await client.query(
          `
          INSERT INTO cash_shifts (
            id,
            user_id,
            user_name,
            branch_id,
            opening_float,
            status,
            notes,
            opening_reference,
            opened_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8::timestamptz, NOW())
          `,
          [shiftId, user.uid, user.displayName || user.username, branchId, openingFloat, notes, openingReference, openedAt]
        );

        await insertAuditLog(
          client,
          { ...user, branchId },
          'OPEN_SHIFT',
          `Opened cashier shift ${shiftId} with float KES ${openingFloat.toLocaleString()}`
        );

        return {
          shift: {
            id: shiftId,
            userId: user.uid,
            userName: user.displayName || user.username,
            branchId,
            openingFloat,
            status: 'open',
            notes,
            openingReference,
            openedAt,
            updatedAt: openedAt
          },
          summary: {
            shiftId,
            branchId,
            openingFloat,
            cashSales: 0,
            cashCreditPayments: 0,
            manualCashIn: 0,
            manualCashOut: 0,
            expectedCash: openingFloat,
            countedCash: null,
            variance: null
          }
        };
      });

      return res.status(201).json(result);
    }

    const closingCountedCash = Number(body.closingCountedCash ?? 0);
    const closingNotes = (body.notes || '').trim() || null;
    if (closingCountedCash < 0) {
      return res.status(400).json({ error: 'Counted cash cannot be negative' });
    }

    const result = await withTransaction(async (client) => {
      const shift = await getOpenShift(client, user.uid);
      if (!shift) {
        throw new Error('There is no open cashier shift to close');
      }

      const summary = await calculateShiftSummary(client, shift.id);
      const variance = closingCountedCash - summary.expectedCash;
      const closedAt = new Date().toISOString();

      await client.query(
        `
        UPDATE cash_shifts
        SET
          status = 'closed',
          closing_notes = $2,
          closing_counted_cash = $3,
          expected_cash = $4,
          variance = $5,
          closed_by_id = $6,
          closed_by_name = $7,
          closed_at = $8::timestamptz,
          updated_at = NOW()
        WHERE id = $1
        `,
        [
          shift.id,
          closingNotes,
          closingCountedCash,
          summary.expectedCash,
          variance,
          user.uid,
          user.displayName || user.username,
          closedAt
        ]
      );

      await insertAuditLog(
        client,
        { ...user, branchId: summary.branchId },
        'CLOSE_SHIFT',
        `Closed cashier shift ${shift.id} with variance KES ${variance.toLocaleString()}`
      );

      return {
        shift: {
          id: shift.id,
          userId: user.uid,
          userName: user.displayName || user.username,
          branchId: summary.branchId,
          openingFloat: summary.openingFloat,
          status: 'closed',
          openedAt: shift.opened_at,
          closedAt,
          closingCountedCash,
          expectedCash: summary.expectedCash,
          variance,
          closingNotes,
          updatedAt: closedAt
        },
        summary: {
          ...summary,
          countedCash: closingCountedCash,
          variance
        }
      };
    });

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode =
      message.includes('already have an open') || message.includes('There is no open')
        ? 409
        : message.includes('Permission denied')
          ? 403
          : message.includes('Shift not found')
            ? 404
        : message.includes('cannot be negative')
          ? 400
          : 500;
    return res.status(statusCode).json({ error: message });
  }
}

function readQueryValue(value: string | string[] | undefined) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].trim();
  }
  return '';
}
