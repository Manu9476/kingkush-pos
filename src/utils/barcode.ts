export function sanitizeScannerValue(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeBarcodeFieldValue(value: string): string {
  return sanitizeScannerValue(value).replace(/\s+/g, '');
}

export function normalizeBarcodeLookup(value: string): string {
  return sanitizeBarcodeFieldValue(value).toLowerCase();
}

export function normalizeScannerName(value: string): string {
  return sanitizeScannerValue(value).toLowerCase();
}

export function isScannerSubmitKey(key: string): boolean {
  return key === 'Enter' || key === 'Tab';
}
