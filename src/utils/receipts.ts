import type { Branch, SystemSettings } from '../types';

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

export function resolveReceiptBranch(
  branches: Branch[],
  branchId?: string | null,
  fallbackBranchId?: string | null
) {
  if (branchId) {
    const primaryBranch = branches.find((branch) => branch.id === branchId);
    if (primaryBranch) {
      return primaryBranch;
    }
  }

  if (fallbackBranchId) {
    const fallbackBranch = branches.find((branch) => branch.id === fallbackBranchId);
    if (fallbackBranch) {
      return fallbackBranch;
    }
  }

  return null;
}

export function getReceiptIdentity(settings?: SystemSettings | null, branch?: Branch | null) {
  return {
    businessName: (settings?.businessName || 'KingKush Sale').trim(),
    branchName: (branch?.name || '').trim(),
    address: (branch?.address || settings?.storeAddress || '').trim(),
    phone: (branch?.phone || settings?.storePhone || '').trim(),
    email: (branch?.email || settings?.storeEmail || '').trim(),
    header: (settings?.receiptHeader || 'Thank you for shopping with us!').trim(),
    footer: (settings?.receiptFooter || 'Goods once sold are not returnable.').trim()
  };
}
