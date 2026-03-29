import { dispatchRouteAction } from '../backend/lib/dispatch.js';
import cashMovementHandler from '../backend/handlers/transactions/cash-movement.js';
import creditPaymentHandler from '../backend/handlers/transactions/credit-payment.js';
import expenseHandler from '../backend/handlers/transactions/expense.js';
import inventoryHandler from '../backend/handlers/transactions/inventory.js';
import purchaseOrderReceiveHandler from '../backend/handlers/transactions/purchase-order-receive.js';
import refundHandler from '../backend/handlers/transactions/refund.js';
import saleHandler from '../backend/handlers/transactions/sale.js';
import shiftHandler from '../backend/handlers/transactions/shift.js';

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
