import { requirePermission } from '../backend/lib/auth.js';
import { queryRows } from '../backend/lib/db.js';
import { readJsonBody } from '../backend/lib/http.js';

type ProductMovementRequest = {
  reportType?: 'product-movement';
  rangeStart?: string;
  rangeEnd?: string;
};

type ProductMovementRow = {
  movement_id: string;
  movement_at: string;
  product_id: string;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  unit_type: string | null;
  movement_type: string;
  source_type: string | null;
  source_id: string | null;
  quantity: number;
  quantity_delta: number;
  resulting_stock: number | null;
  reason: string | null;
  reference: string | null;
  notes: string | null;
  unit_cost: string | null;
  branch_name: string | null;
  branch_code: string | null;
  supplier_name: string | null;
  moved_by_name: string | null;
  moved_by_username: string | null;
  customer_name: string | null;
  sale_reference: string | null;
  payment_method: string | null;
  tender_method: string | null;
};

function parseIsoDate(value: string | undefined, label: string) {
  if (!value) {
    throw new Error(`${label} is required`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} is invalid`);
  }

  return parsed;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const user = await requirePermission(req, res, ['reports']);
    if (!user) {
      return;
    }

    const body = await readJsonBody<ProductMovementRequest>(req);
    if (body.reportType !== 'product-movement') {
      return res.status(400).json({ error: 'Unsupported report type' });
    }

    const rangeStart = parseIsoDate(body.rangeStart, 'Range start');
    const rangeEnd = parseIsoDate(body.rangeEnd, 'Range end');
    if (rangeEnd < rangeStart) {
      return res.status(400).json({ error: 'Range end must be after range start' });
    }

    const rows = await queryRows<ProductMovementRow>(
      `
      SELECT
        l.id AS movement_id,
        l.created_at AS movement_at,
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        p.barcode,
        p.unit_type,
        l.type AS movement_type,
        l.source_type,
        l.source_id,
        l.quantity,
        l.quantity_delta,
        l.resulting_stock,
        l.reason,
        l.reference,
        l.notes,
        l.unit_cost::text,
        b.name AS branch_name,
        b.code AS branch_code,
        COALESCE(sup.payload->>'name', '') AS supplier_name,
        COALESCE(u.display_name, u.username, s.cashier_name, 'System') AS moved_by_name,
        u.username AS moved_by_username,
        s.customer_name,
        s.reference AS sale_reference,
        s.payment_method,
        s.tender_method
      FROM inventory_ledger l
      INNER JOIN products p ON p.id = l.product_id
      LEFT JOIN users u ON u.id = l.user_id
      LEFT JOIN app_documents sup
        ON sup.collection_name = 'suppliers'
       AND sup.id = l.supplier_id
      LEFT JOIN branches b ON b.id = l.branch_id
      LEFT JOIN sales s ON s.id = l.source_id AND l.source_type IN ('sale', 'refund')
      WHERE l.created_at >= $1::timestamptz
        AND l.created_at <= $2::timestamptz
      ORDER BY p.name ASC, l.created_at ASC, l.id ASC
      `,
      [rangeStart.toISOString(), rangeEnd.toISOString()]
    );

    const detailRows = rows.map((row) => {
      const quantityDelta = Number(row.quantity_delta ?? 0);
      const quantityIn = quantityDelta > 0 ? quantityDelta : 0;
      const quantityOut = quantityDelta < 0 ? Math.abs(quantityDelta) : 0;

      return {
        movementId: row.movement_id,
        movementAt: new Date(row.movement_at).toISOString(),
        productId: row.product_id,
        productName: row.product_name,
        sku: row.sku || '',
        barcode: row.barcode || '',
        unitType: row.unit_type || '',
        movementType: row.movement_type,
        sourceType: row.source_type || '',
        sourceId: row.source_id || '',
        quantity: Number(row.quantity ?? 0),
        quantityIn,
        quantityOut,
        netQuantity: quantityDelta,
        resultingStock: row.resulting_stock === null ? '' : Number(row.resulting_stock),
        reason: row.reason || '',
        reference: row.reference || row.sale_reference || '',
        notes: row.notes || '',
        unitCost: row.unit_cost === null || row.unit_cost === undefined ? '' : Number(row.unit_cost),
        branchName: row.branch_name || '',
        branchCode: row.branch_code || '',
        supplierName: row.supplier_name || '',
        movedBy: row.moved_by_name || row.moved_by_username || 'System',
        customerName: row.customer_name || '',
        paymentMethod: row.payment_method || '',
        tenderMethod: row.tender_method || ''
      };
    });

    const summaryByProduct = new Map<
      string,
      {
        productId: string;
        productName: string;
        sku: string;
        barcode: string;
        unitType: string;
        totalMoves: number;
        totalIn: number;
        totalOut: number;
        netQuantity: number;
        latestKnownStock: number | '';
      }
    >();

    for (const row of detailRows) {
      const summary: {
        productId: string;
        productName: string;
        sku: string;
        barcode: string;
        unitType: string;
        totalMoves: number;
        totalIn: number;
        totalOut: number;
        netQuantity: number;
        latestKnownStock: number | '';
      } = summaryByProduct.get(row.productId) || {
        productId: row.productId,
        productName: row.productName,
        sku: row.sku,
        barcode: row.barcode,
        unitType: row.unitType,
        totalMoves: 0,
        totalIn: 0,
        totalOut: 0,
        netQuantity: 0,
        latestKnownStock: ''
      };

      summary.totalMoves += 1;
      summary.totalIn += row.quantityIn;
      summary.totalOut += row.quantityOut;
      summary.netQuantity += row.netQuantity;
      if (row.resultingStock !== '') {
        summary.latestKnownStock = Number(row.resultingStock);
      }

      summaryByProduct.set(row.productId, summary);
    }

    return res.status(200).json({
      range: {
        start: rangeStart.toISOString(),
        end: rangeEnd.toISOString()
      },
      rows: detailRows,
      summary: Array.from(summaryByProduct.values()).sort((a, b) => a.productName.localeCompare(b.productName))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const statusCode =
      message.includes('required') || message.includes('invalid') || message.includes('Unsupported')
        ? 400
        : message.includes('Permission denied')
          ? 403
          : 500;
    return res.status(statusCode).json({ error: message });
  }
}
