import { requirePermission } from '../_lib/auth';
import { insertAuditLog } from '../_lib/audit';
import { createId, withTransaction } from '../_lib/db';
import { readJsonBody } from '../_lib/http';
import { getOpenShift, resolveBranchId } from '../_lib/operations';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const user = await requirePermission(req, res, ['credits']);
    if (!user) {
      return;
    }

    const body = await readJsonBody<{
      creditId?: string;
      amountPaid?: number;
      paymentMethod?: string;
      reference?: string;
    }>(req);

    const creditId = body.creditId || '';
    const amountPaid = Number(body.amountPaid ?? 0);
    const paymentMethod = (body.paymentMethod || 'Cash').trim();
    const reference = (body.reference || '').trim() || null;

    if (!creditId || amountPaid <= 0) {
      return res.status(400).json({ error: 'A valid credit record and payment amount are required' });
    }

    const result = await withTransaction(async (client) => {
      const openShift = await getOpenShift(client, user.uid);
      if (!openShift) {
        throw new Error('An open cashier shift is required before recording a credit payment');
      }
      const branchId = openShift.branch_id || await resolveBranchId(client, user);
      const creditResult = await client.query<{
        id: string;
        sale_id: string;
        customer_id: string | null;
        customer_name: string;
        outstanding_balance: string;
        status: string;
      }>(
        `
        SELECT id, sale_id, customer_id, customer_name, outstanding_balance, status
        FROM credits
        WHERE id = $1
        FOR UPDATE
        `,
        [creditId]
      );
      const credit = creditResult.rows[0];
      if (!credit || credit.status !== 'open') {
        throw new Error('The selected credit is not open for payment');
      }

      const outstandingBalance = Number(credit.outstanding_balance ?? 0);
      if (amountPaid > outstandingBalance) {
        throw new Error('Payment amount cannot exceed the outstanding balance');
      }

      const remainingBalance = Math.max(0, outstandingBalance - amountPaid);
      const paidAt = new Date().toISOString();
      const paymentId = createId('cpay');

      await client.query(
        `
        INSERT INTO credit_payments (
          id,
          credit_id,
          sale_id,
          amount_paid,
          remaining_balance,
          payment_method,
          reference,
          cashier_id,
          cashier_name,
          branch_id,
          shift_id,
          paid_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz)
        `,
        [
          paymentId,
          credit.id,
          credit.sale_id,
          amountPaid,
          remainingBalance,
          paymentMethod,
          reference,
          user.uid,
          user.displayName || user.username,
          branchId,
          openShift.id,
          paidAt
        ]
      );

      await client.query(
        `
        UPDATE credits
        SET
          amount_paid = amount_paid + $2,
          outstanding_balance = outstanding_balance - $2,
          status = CASE WHEN outstanding_balance - $2 <= 0 THEN 'settled' ELSE 'open' END,
          updated_at = NOW()
        WHERE id = $1
        `,
        [credit.id, amountPaid]
      );

      await client.query(
        `
        UPDATE sales
        SET
          amount_paid = amount_paid + $2,
          outstanding_balance = GREATEST(outstanding_balance - $2, 0)
        WHERE id = $1
        `,
        [credit.sale_id, amountPaid]
      );

      if (credit.customer_id) {
        await client.query(
          `
          UPDATE customers
          SET total_balance = GREATEST(total_balance - $2, 0), updated_at = NOW()
          WHERE id = $1
          `,
          [credit.customer_id, amountPaid]
        );
      }

      await insertAuditLog(
        client,
        { ...user, branchId },
        'SETTLE_CREDIT',
        `Recorded KES ${amountPaid.toLocaleString()} for credit ${credit.id}`
      );

      return {
        payment: {
          id: paymentId,
          creditId: credit.id,
          saleId: credit.sale_id,
          amountPaid,
          remainingBalance,
          paymentMethod,
          reference,
          cashierId: user.uid,
          cashierName: user.displayName || user.username,
          branchId,
          shiftId: openShift.id,
          timestamp: paidAt
        }
      };
    });

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode =
      message.includes('selected credit') || message.includes('cannot exceed')
        ? 400
        : message.includes('open cashier shift')
          ? 409
          : 500;
    return res.status(statusCode).json({ error: message });
  }
}
