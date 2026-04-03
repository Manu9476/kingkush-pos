import type { CSSProperties } from 'react';

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

export function getReceiptAppearance(settings?: SystemSettings | null) {
  return {
    paperWidthMm: Math.min(120, Math.max(58, Number(settings?.receiptPaperWidthMm ?? 80))),
    fontSizePx: Math.min(18, Math.max(9, Number(settings?.receiptFontSizePx ?? 12))),
    brandColor: (settings?.receiptBrandColor || '#4f46e5').trim() || '#4f46e5',
    saleTitle: (settings?.receiptSaleTitle || 'SALE RECEIPT').trim() || 'SALE RECEIPT',
    refundTitle: (settings?.receiptRefundTitle || 'REFUND RECEIPT').trim() || 'REFUND RECEIPT',
    creditTitle: (settings?.receiptCreditTitle || 'CREDIT PAYMENT RECEIPT').trim() || 'CREDIT PAYMENT RECEIPT',
    expenseTitle: (settings?.receiptExpenseTitle || 'EXPENSE VOUCHER').trim() || 'EXPENSE VOUCHER',
    shiftTitle: (settings?.receiptShiftTitle || 'CASH SHIFT REPORT').trim() || 'CASH SHIFT REPORT',
    showBranchName: settings?.receiptShowBranchName ?? true,
    showAddress: settings?.receiptShowAddress ?? true,
    showPhone: settings?.receiptShowPhone ?? true,
    showEmail: settings?.receiptShowEmail ?? true,
    showHeader: settings?.receiptShowHeader ?? true,
    showFooter: settings?.receiptShowFooter ?? true,
    showCashier: settings?.receiptShowCashier ?? true,
    showCustomer: settings?.receiptShowCustomer ?? true,
    showReference: settings?.receiptShowReference ?? true,
    showTaxLine: settings?.receiptShowTaxLine ?? true,
    showLoyaltySummary: settings?.receiptShowLoyaltySummary ?? true
  };
}

export function getReceiptContainerStyle(settings?: SystemSettings | null): CSSProperties {
  const appearance = getReceiptAppearance(settings);
  return {
    width: `${appearance.paperWidthMm}mm`,
    maxWidth: '100%',
    fontSize: `${appearance.fontSizePx}px`,
    lineHeight: 1.45,
    color: '#111827'
  };
}
