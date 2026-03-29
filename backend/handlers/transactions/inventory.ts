import { requirePermission } from '../../lib/auth.js';
import { insertAuditLog } from '../../lib/audit.js';
import { createId, withTransaction } from '../../lib/db.js';
import { readJsonBody } from '../../lib/http.js';
import { resolveBranchId } from '../../lib/operations.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const user = await requirePermission(req, res, ['inventory']);
    if (!user) {
      return;
    }

    const body = await readJsonBody<{
      actionType?: 'receiving' | 'stock-in' | 'adjustment';
      productId?: string;
      barcode?: string;
      quantity?: number;
      supplierId?: string;
      unitCost?: number;
      reference?: string;
      reason?: string;
      notes?: string;
    }>(req);

    const actionType = body.actionType || 'adjustment';
    const quantity = Math.trunc(Number(body.quantity ?? 0));
    const supplierId = body.supplierId || null;
    const unitCost = body.unitCost === undefined ? null : Number(body.unitCost);
    const reference = (body.reference || '').trim() || null;
    const reason = (body.reason || '').trim() || null;
    const notes = (body.notes || '').trim() || null;

    if (!body.productId && !body.barcode) {
      return res.status(400).json({ error: 'A product ID or barcode is required' });
    }
    if (quantity === 0) {
      return res.status(400).json({ error: 'Quantity cannot be zero' });
    }

    const result = await withTransaction(async (client) => {
      const branchId = await resolveBranchId(client, user);
      const productResult = await client.query<{
        id: string;
        name: string;
        stock_quantity: number;
      }>(
        `
        SELECT id, name, stock_quantity
        FROM products
        WHERE id = $1 OR barcode = $2
        LIMIT 1
        FOR UPDATE
        `,
        [body.productId || '', body.barcode || '']
      );
      const product = productResult.rows[0];
      if (!product) {
        throw new Error('Product not found');
      }

      const quantityDelta =
        actionType === 'adjustment'
          ? quantity
          : Math.abs(quantity);

      const resultingStock = Number(product.stock_quantity ?? 0) + quantityDelta;
      if (resultingStock < 0) {
        throw new Error('Adjustment would reduce stock below zero');
      }

      const shouldUpdateBuyingPrice = unitCost !== null && Number.isFinite(unitCost) && unitCost > 0;
      if (shouldUpdateBuyingPrice) {
        await client.query(
          `
          UPDATE products
          SET stock_quantity = $2, buying_price = $3, updated_at = NOW()
          WHERE id = $1
          `,
          [product.id, resultingStock, unitCost]
        );
      } else {
        await client.query(
          `
          UPDATE products
          SET stock_quantity = $2, updated_at = NOW()
          WHERE id = $1
          `,
          [product.id, resultingStock]
        );
      }

      const createdAt = new Date().toISOString();
      const ledgerType =
        actionType === 'adjustment'
          ? 'adjustment'
          : 'stock-in';

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
          supplier_id,
          unit_cost,
          reference,
          notes,
          branch_id,
          user_id,
          resulting_stock,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz
        )
        `,
        [
          createId('inv'),
          product.id,
          ledgerType,
          Math.abs(quantityDelta),
          quantityDelta,
          reason || (actionType === 'receiving' ? 'Supplier stock received' : actionType === 'stock-in' ? 'Manual stock-in' : 'Manual adjustment'),
          actionType,
          supplierId,
          unitCost,
          reference,
          notes,
          branchId,
          user.uid,
          resultingStock,
          createdAt
        ]
      );

      await insertAuditLog(
        client,
        { ...user, branchId },
        actionType === 'receiving' ? 'RECEIVE_STOCK' : actionType === 'stock-in' ? 'STOCK_IN' : 'ADJUST_STOCK',
        `${actionType} for ${product.name}: ${quantityDelta > 0 ? '+' : ''}${quantityDelta}`
      );

      return {
        ok: true,
        productId: product.id,
        resultingStock
      };
    });

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode = message.includes('Product') || message.includes('Quantity') || message.includes('below zero') ? 400 : 500;
    return res.status(statusCode).json({ error: message });
  }
}
