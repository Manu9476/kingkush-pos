import { requirePermission } from '../../lib/auth.js';
import { insertAuditLog } from '../../lib/audit.js';
import { createId, withTransaction } from '../../lib/db.js';
import { readJsonBody } from '../../lib/http.js';
import { getOpenShift, insertCashMovement, resolveBranchId } from '../../lib/operations.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const user = await requirePermission(req, res, ['pos', 'sales-history']);
    if (!user) {
      return;
    }

    const body = await readJsonBody<{
      saleId?: string;
      refundReason?: string;
      itemId?: string;
    }>(req);

    const saleId = body.saleId || '';
    const refundReason = (body.refundReason || '').trim();
    const itemId = body.itemId || null;

    if (!saleId || !refundReason) {
      return res.status(400).json({ error: 'Sale ID and refund reason are required' });
    }

    const result = await withTransaction(async (client) => {
      const saleResult = await client.query<{
        id: string;
        customer_id: string | null;
        customer_name: string | null;
        branch_id: string | null;
        is_credit: boolean;
        is_refunded: boolean;
        payment_method: string;
        tender_method: string | null;
        outstanding_balance: string;
        refund_amount: string;
        refund_reason: string | null;
      }>(
        `
        SELECT
          id,
          customer_id,
          customer_name,
          branch_id,
          is_credit,
          is_refunded,
          payment_method,
          tender_method,
          outstanding_balance,
          refund_amount,
          refund_reason
        FROM sales
        WHERE id = $1
        FOR UPDATE
        `,
        [saleId]
      );
      const sale = saleResult.rows[0];
      if (!sale) {
        throw new Error('Sale not found');
      }

      const itemsResult = await client.query<{
        id: string;
        product_id: string;
        product_name: string;
        quantity: number;
        unit_price: string;
        total_price: string;
        is_refunded: boolean;
      }>(
        `
        SELECT id, product_id, product_name, quantity, unit_price, total_price, is_refunded
        FROM sale_items
        WHERE sale_id = $1
        FOR UPDATE
        `,
        [saleId]
      );

      const targetItems = itemId
        ? itemsResult.rows.filter((item) => item.id === itemId)
        : itemsResult.rows.filter((item) => !item.is_refunded);

      if (targetItems.length === 0) {
        throw new Error(itemId ? 'Selected sale item is not refundable' : 'No refundable items remain on this sale');
      }
      if (targetItems.some((item) => item.is_refunded)) {
        throw new Error('Selected sale item is already refunded');
      }

      const refundedAt = new Date().toISOString();
      const refundAmount = targetItems.reduce((sum, item) => sum + Number(item.total_price ?? 0), 0);
      const effectiveTenderMethod = (sale.tender_method || sale.payment_method || '').toLowerCase();
      const openShift = await getOpenShift(client, user.uid);
      const branchId = sale.branch_id || await resolveBranchId(client, user);
      if (effectiveTenderMethod === 'cash' && !openShift) {
        throw new Error('An open cashier shift is required before processing a cash refund');
      }

      for (const item of targetItems) {
        await client.query(
          `
          UPDATE sale_items
          SET
            is_refunded = TRUE,
            status = 'refunded',
            refunded_at = $2::timestamptz,
            refunded_by = $3
          WHERE id = $1
          `,
          [item.id, refundedAt, user.displayName || user.username]
        );

        await client.query(
          `
          UPDATE products
          SET stock_quantity = stock_quantity + $2, updated_at = NOW()
          WHERE id = $1
          `,
          [item.product_id, item.quantity]
        );

        await client.query(
          `
          INSERT INTO inventory_ledger (
            id,
            product_id,
            type,
            quantity,
            quantity_delta,
            reason,
            source_type,
            source_id,
            branch_id,
            user_id,
            created_at
          )
          VALUES ($1, $2, 'stock-in', $3, $4, $5, 'refund', $6, $7, $8, $9::timestamptz)
          `,
          [
            createId('inv'),
            item.product_id,
            item.quantity,
            Math.abs(item.quantity),
            `${itemId ? 'Partial' : 'Full'} refund: Sale ${saleId}`,
            saleId,
            branchId,
            user.uid,
            refundedAt
          ]
        );
      }

      const remainingUnrefunded = itemsResult.rows.filter((item) =>
        targetItems.every((target) => target.id !== item.id) && !item.is_refunded
      );
      const fullyRefunded = remainingUnrefunded.length === 0;
      const aggregateRefundReason = sale.refund_reason
        ? `${sale.refund_reason} | ${refundReason}`
        : refundReason;
      const totalRefundAmount = Number(sale.refund_amount ?? 0) + refundAmount;
      const updatedOutstandingBalance = Math.max(0, Number(sale.outstanding_balance ?? 0) - refundAmount);

      await client.query(
        `
        UPDATE sales
        SET
          refund_amount = refund_amount + $2,
          is_refunded = CASE WHEN $3::boolean THEN TRUE ELSE is_refunded END,
          refunded_at = $4::timestamptz,
          refunded_by = $5,
          refund_reason = $6,
          outstanding_balance = GREATEST(outstanding_balance - $2, 0)
        WHERE id = $1
        `,
        [saleId, refundAmount, fullyRefunded, refundedAt, user.displayName || user.username, aggregateRefundReason]
      );

      if (sale.customer_id && sale.is_credit) {
        await client.query(
          `
          UPDATE customers
          SET total_balance = GREATEST(total_balance - $2, 0), updated_at = NOW()
          WHERE id = $1
          `,
          [sale.customer_id, refundAmount]
        );

        await client.query(
          `
          UPDATE credits
          SET
            outstanding_balance = GREATEST(outstanding_balance - $2, 0),
            status = CASE WHEN outstanding_balance - $2 <= 0 THEN 'settled' ELSE status END,
            refunded_at = CASE WHEN outstanding_balance - $2 <= 0 THEN $3::timestamptz ELSE refunded_at END,
            updated_at = NOW()
          WHERE sale_id = $1
          `,
          [saleId, refundAmount, refundedAt]
        );
      }

      if (effectiveTenderMethod === 'cash' && openShift) {
        await insertCashMovement(client, {
          shiftId: openShift.id,
          branchId,
          userId: user.uid,
          userName: user.displayName || user.username,
          type: 'refund',
          amount: refundAmount,
          reason: `${itemId ? 'Partial' : 'Full'} refund for sale ${saleId}`,
          reference: refundReason,
          createdAt: refundedAt
        });
      }

      await insertAuditLog(
        client,
        { ...user, branchId },
        itemId ? 'PARTIAL_REFUND' : 'REFUND_SALE',
        `${itemId ? 'Partially refunded' : 'Refunded'} sale ${saleId}. Reason: ${refundReason}`
      );

      return {
        ok: true,
        refundAmount,
        fullyRefunded,
        sale: {
          id: saleId,
          isRefunded: fullyRefunded,
          refundAmount: totalRefundAmount,
          refundedAt,
          refundedBy: user.displayName || user.username,
          refundReason: aggregateRefundReason,
          outstandingBalance: updatedOutstandingBalance
        }
      };
    });

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode =
      message.includes('required') || message.includes('refundable') || message.includes('not found')
        ? 400
        : message.includes('open cashier shift')
          ? 409
        : 500;
    return res.status(statusCode).json({ error: message });
  }
}
