import { requirePermission } from '../../lib/auth.js';
import { insertAuditLog } from '../../lib/audit.js';
import { withTransaction } from '../../lib/db.js';
import { readJsonBody } from '../../lib/http.js';
import { getOpenShift, insertCashMovement, resolveBranchId } from '../../lib/operations.js';

const ALLOWED_MOVEMENTS = new Set(['cash-in', 'cash-out', 'float-add', 'safe-drop']);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const user = await requirePermission(req, res, ['shifts', 'pos']);
    if (!user) {
      return;
    }

    const body = await readJsonBody<{
      type?: 'cash-in' | 'cash-out' | 'float-add' | 'safe-drop';
      amount?: number;
      reason?: string;
      reference?: string;
    }>(req);

    const type = body.type || 'cash-out';
    const amount = Number(body.amount ?? 0);
    const reason = (body.reason || '').trim();
    const reference = (body.reference || '').trim() || null;

    if (!ALLOWED_MOVEMENTS.has(type)) {
      return res.status(400).json({ error: 'Unsupported cash movement type' });
    }
    if (!reason || amount <= 0) {
      return res.status(400).json({ error: 'A reason and a positive amount are required' });
    }

    const result = await withTransaction(async (client) => {
      const shift = await getOpenShift(client, user.uid);
      if (!shift) {
        throw new Error('An open cashier shift is required before recording a cash movement');
      }

      const branchId = shift.branch_id || await resolveBranchId(client, user);
      await insertCashMovement(client, {
        shiftId: shift.id,
        branchId,
        userId: user.uid,
        userName: user.displayName || user.username,
        type,
        amount,
        reason,
        reference
      });

      await insertAuditLog(
        client,
        { ...user, branchId },
        'CASH_MOVEMENT',
        `Recorded ${type} of KES ${amount.toLocaleString()} on shift ${shift.id}`
      );

      return {
        ok: true,
        shiftId: shift.id,
        branchId,
        type,
        amount,
        reason,
        reference
      };
    });

    return res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode =
      message.includes('required') || message.includes('Unsupported')
        ? 400
        : message.includes('open cashier shift')
          ? 409
          : 500;
    return res.status(statusCode).json({ error: message });
  }
}
