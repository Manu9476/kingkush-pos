import { requirePermission } from '../_lib/auth';
import { insertAuditLog } from '../_lib/audit';
import { createId, withTransaction } from '../_lib/db';
import { readJsonBody } from '../_lib/http';
import { getOpenShift, insertCashMovement, resolveBranchId } from '../_lib/operations';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const user = await requirePermission(req, res, ['expenses']);
    if (!user) {
      return;
    }

    const body = await readJsonBody<{
      category?: string;
      description?: string;
      amount?: number;
      paymentMethod?: 'cash' | 'mpesa' | 'bank' | 'other';
      reference?: string;
    }>(req);

    const category = (body.category || '').trim();
    const description = (body.description || '').trim();
    const amount = Number(body.amount ?? 0);
    const paymentMethod = body.paymentMethod || 'cash';
    const reference = (body.reference || '').trim() || null;

    if (!category || !description || amount <= 0) {
      return res.status(400).json({ error: 'Category, description, and a positive amount are required' });
    }

    const result = await withTransaction(async (client) => {
      const branchId = await resolveBranchId(client, user);
      const shift = await getOpenShift(client, user.uid);
      if (paymentMethod === 'cash' && !shift) {
        throw new Error('An open cashier shift is required before recording a cash expense');
      }
      const expenseId = createId('exp');
      const createdAt = new Date().toISOString();

      const payload = {
        category,
        description,
        amount,
        paymentMethod,
        reference,
        recordedBy: user.uid,
        recordedByName: user.displayName || user.username,
        branchId,
        shiftId: shift?.id || null,
        date: createdAt
      };

      await client.query(
        `
        INSERT INTO app_documents (collection_name, id, payload, created_at, updated_at)
        VALUES ('expenses', $1, $2::jsonb, $3::timestamptz, NOW())
        `,
        [expenseId, JSON.stringify(payload), createdAt]
      );

      if (paymentMethod === 'cash' && shift) {
        await insertCashMovement(client, {
          shiftId: shift.id,
          branchId,
          userId: user.uid,
          userName: user.displayName || user.username,
          type: 'expense',
          amount,
          reason: `Expense: ${category} - ${description}`,
          reference,
          createdAt
        });
      }

      await insertAuditLog(
        client,
        { ...user, branchId },
        'RECORD_EXPENSE',
        `Recorded ${category} expense for KES ${amount.toLocaleString()}`
      );

      return {
        expense: {
          id: expenseId,
          ...payload
        }
      };
    });

    return res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode =
      message.includes('required')
        ? 400
        : message.includes('open cashier shift')
          ? 409
          : 500;
    return res.status(statusCode).json({ error: message });
  }
}
