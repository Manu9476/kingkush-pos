import { requirePermission } from '../_lib/auth';
import { insertAuditLog } from '../_lib/audit';
import { createId, withTransaction } from '../_lib/db';
import { readJsonBody } from '../_lib/http';
import { calculateShiftSummary, getOpenShift, resolveBranchId } from '../_lib/operations';

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
      const payload = await withTransaction(async (client) => {
        const shift = await getOpenShift(client, user.uid);
        if (!shift) {
          return { shift: null, summary: null };
        }

        const summary = await calculateShiftSummary(client, shift.id);
        return {
          shift: {
            id: shift.id,
            branchId: shift.branch_id,
            openingFloat: Number(shift.opening_float ?? 0),
            status: shift.status,
            notes: shift.notes,
            openingReference: shift.opening_reference,
            closingCountedCash: shift.closing_counted_cash === null ? undefined : Number(shift.closing_counted_cash),
            expectedCash: shift.expected_cash === null ? undefined : Number(shift.expected_cash),
            variance: shift.variance === null ? undefined : Number(shift.variance),
            openedAt: shift.opened_at
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
            branchId,
            openingFloat,
            status: 'open',
            notes,
            openingReference,
            openedAt
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
          branchId: summary.branchId,
          openingFloat: summary.openingFloat,
          status: 'closed',
          openedAt: shift.opened_at,
          closedAt,
          closingCountedCash,
          expectedCash: summary.expectedCash,
          variance,
          closingNotes
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
        : message.includes('cannot be negative')
          ? 400
          : 500;
    return res.status(statusCode).json({ error: message });
  }
}
