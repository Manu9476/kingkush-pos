import { dispatchRouteAction } from '../../backend/lib/dispatch';
import cashMovementHandler from '../../backend/handlers/transactions/cash-movement';
import creditPaymentHandler from '../../backend/handlers/transactions/credit-payment';
import expenseHandler from '../../backend/handlers/transactions/expense';
import inventoryHandler from '../../backend/handlers/transactions/inventory';
import purchaseOrderReceiveHandler from '../../backend/handlers/transactions/purchase-order-receive';
import refundHandler from '../../backend/handlers/transactions/refund';
import saleHandler from '../../backend/handlers/transactions/sale';
import shiftHandler from '../../backend/handlers/transactions/shift';

const handlers = {
  'cash-movement': cashMovementHandler,
  'credit-payment': creditPaymentHandler,
  expense: expenseHandler,
  inventory: inventoryHandler,
  'purchase-order-receive': purchaseOrderReceiveHandler,
  refund: refundHandler,
  sale: saleHandler,
  shift: shiftHandler
};

export default async function handler(req: any, res: any) {
  return dispatchRouteAction(req, res, '/api/transactions', handlers);
}
