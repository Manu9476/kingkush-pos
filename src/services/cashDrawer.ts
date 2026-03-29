import { toast } from 'sonner';

import type { Sale, SystemSettings } from '../types';

const DEFAULT_HELPER_URL = 'http://127.0.0.1:17363';

type TriggerOptions = {
  eventType: 'sale' | 'manual' | 'test';
  saleId?: string;
  amount?: number;
  paymentMethod?: string;
  reference?: string;
  announceSuccess?: boolean;
  suppressFailureToast?: boolean;
  successMessage?: string;
};

export function normalizeCashDrawerHelperUrl(url?: string | null) {
  const value = (url || '').trim() || DEFAULT_HELPER_URL;
  return value.replace(/\/+$/, '');
}

export function isCashDrawerEnabled(settings?: SystemSettings | null) {
  return Boolean(settings?.drawerEnabled);
}

export function saleUsesCashDrawer(sale: Sale) {
  const effectiveTender = String(sale.tenderMethod || sale.paymentMethod || '').toLowerCase();
  return effectiveTender === 'cash' && Number(sale.amountPaid ?? 0) > 0;
}

export async function triggerCashDrawer(settings: SystemSettings, options: TriggerOptions) {
  if (!settings.drawerEnabled) {
    throw new Error('Cash drawer integration is disabled in Settings.');
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(`${normalizeCashDrawerHelperUrl(settings.drawerHelperUrl)}/open-drawer`, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        eventType: options.eventType,
        saleId: options.saleId,
        amount: options.amount,
        paymentMethod: options.paymentMethod,
        reference: options.reference,
        triggeredAt: new Date().toISOString(),
        source: 'kingkush-sale-web'
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({} as { error?: string; ok?: boolean }));
    if (!response.ok) {
      throw new Error(typeof payload.error === 'string' ? payload.error : 'Cash drawer helper rejected the request.');
    }

    if (options.announceSuccess) {
      toast.success(options.successMessage || 'Cash drawer opened.');
    }

    return payload;
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'Cash drawer helper timed out. Confirm the cashier helper is running.'
        : error instanceof TypeError
          ? 'Could not reach the cash drawer helper. Confirm it is running on this cashier PC and restart it after pulling the latest code.'
        : error instanceof Error
          ? error.message
          : 'Failed to trigger the cash drawer.';

    if (!options.suppressFailureToast) {
      toast.error(message);
    }

    throw new Error(message);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function testCashDrawer(settings: SystemSettings) {
  return triggerCashDrawer(settings, {
    eventType: 'test',
    announceSuccess: true,
    successMessage: 'Cash drawer test signal sent.'
  });
}
