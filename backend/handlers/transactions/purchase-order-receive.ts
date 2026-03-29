import { requirePermission } from '../../lib/auth.js';
import { insertAuditLog } from '../../lib/audit.js';
import { createId, withTransaction } from '../../lib/db.js';
import { readJsonBody } from '../../lib/http.js';
import { resolveBranchId } from '../../lib/operations.js';

type PurchaseOrderPayload = {
  supplierId?: string;
  supplierName?: string;
  status?: string;
  items?: Array<{
    productId: string;
    productName: string;
    quantity: number;
    costPrice: number;
  }>;
  notes?: string;
  createdAt?: string;
  createdBy?: string;
  receivedAt?: string;
  receivedBy?: string;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const user = await requirePermission(req, res, ['purchase-orders', 'inventory']);
    if (!user) {
      return;
    }

    const body = await readJsonBody<{ orderId?: string }>(req);
    const orderId = body.orderId || '';
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    const result = await withTransaction(async (client) => {
      const branchId = await resolveBranchId(client, user);
      const orderResult = await client.query<{ id: string; payload: PurchaseOrderPayload }>(
        `
        SELECT id, payload
        FROM app_documents
        WHERE collection_name = 'purchase_orders' AND id = $1
        FOR UPDATE
        `,
        [orderId]
      );
      const orderRow = orderResult.rows[0];
      if (!orderRow) {
        throw new Error('Purchase order not found');
      }

      const payload = orderRow.payload || {};
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (payload.status !== 'pending') {
        throw new Error('Only pending purchase orders can be received');
      }
      if (items.length === 0) {
        throw new Error('Purchase order does not contain any items');
      }

      const productIds = items.map((item) => item.productId);
      await client.query(
        `
        SELECT id
        FROM products
        WHERE id = ANY($1::text[])
        FOR UPDATE
        `,
        [productIds]
      );

      const receivedAt = new Date().toISOString();
      for (const item of items) {
        await client.query(
          `
          UPDATE products
          SET
            stock_quantity = stock_quantity + $2,
            buying_price = $3,
            updated_at = NOW()
          WHERE id = $1
          `,
          [item.productId, item.quantity, item.costPrice]
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
            supplier_id,
            unit_cost,
            notes,
            branch_id,
            user_id,
            created_at
          )
          VALUES (
            $1, $2, 'stock-in', $3, $4, $5, 'purchase-order', $6, $7, $8, $9, $10, $11, $12::timestamptz
          )
          `,
          [
            createId('inv'),
            item.productId,
            item.quantity,
            Math.abs(item.quantity),
            `Purchase order received: ${orderId}`,
            orderId,
            payload.supplierId || null,
            item.costPrice,
            payload.notes || null,
            branchId,
            user.uid,
            receivedAt
          ]
        );
      }

      const updatedPayload: PurchaseOrderPayload = {
        ...payload,
        status: 'received',
        receivedAt,
        receivedBy: user.displayName || user.username
      };

      await client.query(
        `
        UPDATE app_documents
        SET payload = $2::jsonb, updated_at = NOW()
        WHERE collection_name = 'purchase_orders' AND id = $1
        `,
        [orderId, JSON.stringify(updatedPayload)]
      );

      await insertAuditLog(
        client,
        { ...user, branchId },
        'RECEIVE_PO',
        `Received purchase order ${orderId} from ${payload.supplierName || 'Unknown supplier'}`
      );

      return { ok: true, orderId };
    });

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode = message.includes('Purchase order') || message.includes('pending') || message.includes('items') ? 400 : 500;
    return res.status(statusCode).json({ error: message });
  }
}
