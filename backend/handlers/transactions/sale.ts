import { requirePermission } from '../../lib/auth.js';
import { insertAuditLog } from '../../lib/audit.js';
import { createId, withTransaction } from '../../lib/db.js';
import { readJsonBody } from '../../lib/http.js';
import { getOpenShift, resolveBranchId } from '../../lib/operations.js';

type SaleItemInput = {
  id: string;
  name: string;
  barcode: string;
  quantity: number;
  sellingPrice: number;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const user = await requirePermission(req, res, ['pos']);
    if (!user) {
      return;
    }

    const body = await readJsonBody<{
      items?: SaleItemInput[];
      paymentMethod?: 'cash' | 'mpesa' | 'card' | 'credit';
      tenderMethod?: 'cash' | 'mpesa' | 'card' | 'credit';
      amountPaid?: number;
      customerId?: string;
      customerName?: string;
      reference?: string;
    }>(req);

    const items = Array.isArray(body.items) ? body.items : [];
    const requestedPaymentMethod = body.paymentMethod || 'cash';
    const amountPaid = Number(body.amountPaid ?? 0);
    const requestedTenderMethod =
      body.tenderMethod ||
      (requestedPaymentMethod === 'credit'
        ? (amountPaid > 0 ? 'cash' : 'credit')
        : requestedPaymentMethod);
    const customerId = body.customerId || null;
    const customerName = (body.customerName || '').trim() || null;
    const reference = (body.reference || '').trim() || null;

    if (items.length === 0) {
      return res.status(400).json({ error: 'At least one sale item is required' });
    }
    if (items.some((item) => !item.id || item.quantity <= 0 || item.sellingPrice < 0)) {
      return res.status(400).json({ error: 'Each sale item must include a valid product, quantity, and price' });
    }

    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
      return res.status(400).json({ error: 'Amount paid must be a valid positive number' });
    }

    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.sellingPrice, 0);
    const outstandingBalance = Math.max(0, subtotal - amountPaid);
    const isCredit = outstandingBalance > 0;
    const tenderMethod = requestedTenderMethod;
    const paymentMethod = isCredit ? 'credit' : tenderMethod;
    if (isCredit && !customerId && !customerName) {
      return res.status(400).json({ error: 'Select or enter a customer before saving a credit balance' });
    }

    const result = await withTransaction(async (client) => {
      const openShift = await getOpenShift(client, user.uid);
      if (!openShift) {
        throw new Error('An open cashier shift is required before completing a sale');
      }
      const branchId = openShift.branch_id || await resolveBranchId(client, user);
      const settingsResult = await client.query<{
        tax_rate: string;
        loyalty_point_rate: string;
      }>('SELECT tax_rate, loyalty_point_rate FROM system_settings WHERE id = $1 LIMIT 1', ['system']);
      const settings = settingsResult.rows[0];
      const taxRate = Number(settings?.tax_rate ?? 0);
      const loyaltyPointRate = Number(settings?.loyalty_point_rate ?? 100);

      const productIds = items.map((item) => item.id);
      const productsResult = await client.query<{
        id: string;
        name: string;
        barcode: string;
        stock_quantity: number;
      }>(
        `
        SELECT id, name, barcode, stock_quantity
        FROM products
        WHERE id = ANY($1::text[])
        FOR UPDATE
        `,
        [productIds]
      );
      const productsById = new Map(productsResult.rows.map((row) => [row.id, row]));
      if (productsById.size !== productIds.length) {
        throw new Error('One or more products could not be found');
      }

      for (const item of items) {
        const product = productsById.get(item.id);
        if (!product || Number(product.stock_quantity) < item.quantity) {
          throw new Error(`Insufficient stock for ${item.name}`);
        }
      }

      let saleCustomerId = customerId;
      let saleCustomerName = customerName;
      let customerBalance = 0;
      if (saleCustomerId) {
        const customerResult = await client.query<{ id: string; name: string; total_balance: string }>(
          'SELECT id, name, total_balance FROM customers WHERE id = $1 FOR UPDATE',
          [saleCustomerId]
        );
        const existingCustomer = customerResult.rows[0];
        if (!existingCustomer) {
          throw new Error('Selected customer was not found');
        }
        customerBalance = Number(existingCustomer.total_balance ?? 0);
        if (!saleCustomerName) {
          saleCustomerName = existingCustomer.name;
        }
      } else if (isCredit && saleCustomerName) {
        saleCustomerId = createId('cust');
        await client.query(
          `
          INSERT INTO customers (
            id,
            customer_code,
            name,
            loyalty_points,
            total_balance,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, 0, 0, NOW(), NOW())
          `,
          [
            saleCustomerId,
            `CUST-${saleCustomerId.slice(-6).toUpperCase()}`,
            saleCustomerName
          ]
        );
      }

      const saleId = createId('sale');
      const soldAt = new Date().toISOString();
      let excessToApply = !isCredit && saleCustomerId && amountPaid > subtotal ? amountPaid - subtotal : 0;
      let appliedToCredits = 0;
      const taxAmount = Number(((subtotal * taxRate) / 100).toFixed(2));

      await client.query(
        `
        INSERT INTO sales (
          id,
          cashier_id,
          cashier_name,
          branch_id,
          shift_id,
          total_amount,
          tax_amount,
          payment_method,
          tender_method,
          amount_paid,
          balance,
          customer_name,
          customer_id,
          reference,
          is_credit,
          outstanding_balance,
          sold_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12, $13, $14, $15, $16::timestamptz)
        `,
        [
          saleId,
          user.uid,
          user.displayName || user.username,
          branchId,
          openShift.id,
          subtotal,
          taxAmount,
          paymentMethod,
          tenderMethod,
          amountPaid,
          saleCustomerName,
          saleCustomerId,
          reference,
          isCredit,
          outstandingBalance,
          soldAt
        ]
      );

      for (const item of items) {
        const saleItemId = createId('item');
        await client.query(
          `
          INSERT INTO sale_items (
            id,
            sale_id,
            product_id,
            product_name,
            barcode,
            quantity,
            unit_price,
            total_price,
            display_name,
            selling_price,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)
          `,
          [
            saleItemId,
            saleId,
            item.id,
            item.name,
            item.barcode,
            item.quantity,
            item.sellingPrice,
            item.quantity * item.sellingPrice,
            item.name,
            item.sellingPrice,
            soldAt
          ]
        );

        await client.query(
          `
          UPDATE products
          SET stock_quantity = stock_quantity - $2, updated_at = NOW()
          WHERE id = $1
          `,
          [item.id, item.quantity]
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
            reference,
            branch_id,
            user_id,
            created_at
          )
          VALUES ($1, $2, 'stock-out', $3, $4, $5, 'sale', $6, $7, $8, $9, $10::timestamptz)
          `,
          [
            createId('inv'),
            item.id,
            item.quantity,
            -Math.abs(item.quantity),
            `Sale ${saleId}`,
            saleId,
            reference,
            branchId,
            user.uid,
            soldAt
          ]
        );
      }

      if (saleCustomerId && loyaltyPointRate > 0) {
        const pointsEarned = Math.floor(subtotal / loyaltyPointRate);
        if (pointsEarned > 0) {
          await client.query(
            `
            UPDATE customers
            SET loyalty_points = loyalty_points + $2, updated_at = NOW()
            WHERE id = $1
            `,
            [saleCustomerId, pointsEarned]
          );
        }
      }

      if (isCredit) {
        await client.query(
          `
          INSERT INTO credits (
            id,
            sale_id,
            customer_id,
            customer_name,
            total_amount,
            amount_paid,
            outstanding_balance,
            items,
            status,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9::timestamptz, NOW())
          `,
          [
            createId('cred'),
            saleId,
            saleCustomerId,
            saleCustomerName || 'Walk-in Customer',
            subtotal,
            amountPaid,
            outstandingBalance,
            items.map((item) => `${item.name} x${item.quantity}`).join(', '),
            soldAt
          ]
        );

        if (saleCustomerId) {
          await client.query(
            `
            UPDATE customers
            SET total_balance = total_balance + $2, updated_at = NOW()
            WHERE id = $1
            `,
            [saleCustomerId, outstandingBalance]
          );
          customerBalance += outstandingBalance;
        }
      }

      if (excessToApply > 0 && saleCustomerId) {
        const creditRows = await client.query<{
          id: string;
          sale_id: string;
          outstanding_balance: string;
        }>(
          `
          SELECT id, sale_id, outstanding_balance
          FROM credits
          WHERE customer_id = $1 AND status = 'open'
          ORDER BY created_at ASC
          FOR UPDATE
          `,
          [saleCustomerId]
        );

        for (const credit of creditRows.rows) {
          if (excessToApply <= 0) {
            break;
          }
          const outstanding = Number(credit.outstanding_balance ?? 0);
          const paymentToApply = Math.min(outstanding, excessToApply);
          if (paymentToApply <= 0) {
            continue;
          }

          const newOutstanding = outstanding - paymentToApply;
          await client.query(
            `
            UPDATE credits
            SET
              amount_paid = amount_paid + $2,
              outstanding_balance = outstanding_balance - $2,
              status = CASE WHEN outstanding_balance - $2 <= 0 THEN 'settled' ELSE status END,
              updated_at = NOW()
            WHERE id = $1
            `,
            [credit.id, paymentToApply]
          );

          await client.query(
            `
            UPDATE sales
            SET
              amount_paid = amount_paid + $2,
              outstanding_balance = GREATEST(outstanding_balance - $2, 0)
            WHERE id = $1
            `,
            [credit.sale_id, paymentToApply]
          );

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
              createId('cpay'),
              credit.id,
              credit.sale_id,
              paymentToApply,
              newOutstanding,
              paymentMethod,
              `Sale excess applied from ${saleId}`,
              user.uid,
              user.displayName || user.username,
              branchId,
              openShift.id,
              soldAt
            ]
          );

          excessToApply -= paymentToApply;
          appliedToCredits += paymentToApply;
        }

        if (appliedToCredits > 0) {
          await client.query(
            `
            UPDATE customers
            SET total_balance = GREATEST(total_balance - $2, 0), updated_at = NOW()
            WHERE id = $1
            `,
            [saleCustomerId, appliedToCredits]
          );
          customerBalance = Math.max(0, customerBalance - appliedToCredits);
        }
      }

      const change = !isCredit ? Math.max(0, amountPaid - subtotal - appliedToCredits) : 0;
      await client.query('UPDATE sales SET balance = $2 WHERE id = $1', [saleId, change]);

      await insertAuditLog(
        client,
        { ...user, branchId },
        'COMPLETE_SALE',
        `Completed sale ${saleId} for KES ${subtotal.toLocaleString()}`
      );

      return {
        sale: {
          id: saleId,
          cashierId: user.uid,
          cashierName: user.displayName || user.username,
          totalAmount: subtotal,
          taxAmount,
          paymentMethod,
          amountPaid,
          balance: change,
          customerName: saleCustomerName,
          customerId: saleCustomerId,
          reference,
          isCredit,
          outstandingBalance,
          branchId,
          shiftId: openShift.id,
          tenderMethod,
          timestamp: soldAt,
          newTotalBalance: customerBalance
        }
      };
    });

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode =
      message.includes('Insufficient stock') ||
      message.includes('required') ||
      message.includes('At least one') ||
      message.includes('valid positive number') ||
      message.includes('customer') ||
      message.includes('not found')
        ? 400
        : message.includes('open cashier shift')
          ? 409
          : 500;
    return res.status(statusCode).json({ error: message });
  }
}
