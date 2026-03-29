function compactSuffix(id: string) {
  return id.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase() || '00000000';
}

export function formatReceiptNumber(id: string, prefix = 'RCPT') {
  return `${prefix}-${compactSuffix(id)}`;
}

export function formatSaleReceiptNumber(id: string) {
  return formatReceiptNumber(id, 'SALE');
}

export function formatRefundReceiptNumber(id: string) {
  return formatReceiptNumber(id, 'RFND');
}

export function formatCreditReceiptNumber(id: string) {
  return formatReceiptNumber(id, 'CRDT');
}

export function formatShiftReportNumber(id: string) {
  return formatReceiptNumber(id, 'SHIFT');
}
