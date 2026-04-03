import React, { useEffect, useState } from 'react';
import {
  db,
  doc,
  getDoc,
  setDoc,
  collection,
  onSnapshot,
  handleFirestoreError,
  OperationType
} from '../data';
import type { Branch, SystemSettings } from '../types';
import { useAuth } from '../App';
import {
  Settings as SettingsIcon,
  Save,
  CheckCircle,
  Shield,
  Key,
  AlertCircle,
  User as UserIcon,
  Eye,
  EyeOff,
  Store,
  Printer,
  ScanLine,
  Palette,
  Trash2,
  Search
} from 'lucide-react';
import { toast } from 'sonner';

import ConfirmDialog from './ConfirmDialog';
import { recordAuditLog } from '../services/auditService';
import { testCashDrawer } from '../services/cashDrawer';
import {
  changePassword,
  deleteSystemReceipt,
  getSystemStatusReport,
  purgeSystemHistory,
  searchSystemReceipts,
  type SystemReceiptKind,
  type SystemReceiptSearchResult,
  type SystemStatusReport
} from '../services/platformApi';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeColor(value: string, fallback: string) {
  const trimmed = value.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : fallback;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function formatDateTimeLocal(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const DEFAULT_SETTINGS: SystemSettings = {
  id: 'system',
  skuPrefix: 'KK-',
  badDebtThresholdDays: 30,
  taxRate: 16,
  loyaltyPointRate: 100,
  businessName: 'KingKush Sale',
  storeAddress: '',
  storePhone: '',
  storeEmail: '',
  receiptHeader: 'Thank you for shopping with us!',
  receiptFooter: 'Goods once sold are not returnable.',
  receiptAutoPrint: false,
  receiptPaperWidthMm: 80,
  receiptFontSizePx: 12,
  receiptBrandColor: '#4f46e5',
  receiptSaleTitle: 'SALE RECEIPT',
  receiptRefundTitle: 'REFUND RECEIPT',
  receiptCreditTitle: 'CREDIT PAYMENT RECEIPT',
  receiptExpenseTitle: 'EXPENSE VOUCHER',
  receiptShiftTitle: 'CASH SHIFT REPORT',
  receiptShowBranchName: true,
  receiptShowAddress: true,
  receiptShowPhone: true,
  receiptShowEmail: true,
  receiptShowHeader: true,
  receiptShowFooter: true,
  receiptShowCashier: true,
  receiptShowCustomer: true,
  receiptShowReference: true,
  receiptShowTaxLine: true,
  receiptShowLoyaltySummary: true,
  drawerEnabled: false,
  drawerAutoOpenOnCashSale: false,
  drawerHelperUrl: 'http://127.0.0.1:17363',
  barcodeAutofocus: true,
  barcodeSubmitDelayMs: 120,
  defaultBranchId: 'branch_main',
  updatedAt: new Date().toISOString()
};

export default function Settings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isTestingDrawer, setIsTestingDrawer] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [systemReport, setSystemReport] = useState<SystemStatusReport | null>(null);
  const [isLoadingSystemReport, setIsLoadingSystemReport] = useState(false);
  const [purgingScopeId, setPurgingScopeId] = useState<string | null>(null);
  const [receiptKind, setReceiptKind] = useState<'all' | SystemReceiptKind>('all');
  const [receiptQuery, setReceiptQuery] = useState('');
  const [receiptDateFrom, setReceiptDateFrom] = useState(() => formatDateTimeLocal(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)));
  const [receiptDateTo, setReceiptDateTo] = useState(() => formatDateTimeLocal(new Date()));
  const [receiptResults, setReceiptResults] = useState<SystemReceiptSearchResult[]>([]);
  const [isSearchingReceipts, setIsSearchingReceipts] = useState(false);
  const [deletingReceiptKey, setDeletingReceiptKey] = useState<string | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
    type?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    onConfirm: () => {},
    type: 'warning'
  });

  const refreshSystemReport = async () => {
    setIsLoadingSystemReport(true);
    try {
      const report = await getSystemStatusReport();
      setSystemReport(report);
    } catch (error: any) {
      toast.error(error.message || 'Unable to load cleanup controls');
    } finally {
      setIsLoadingSystemReport(false);
    }
  };

  const loadReceiptResults = async () => {
    const fromDate = receiptDateFrom ? new Date(receiptDateFrom) : null;
    const toDate = receiptDateTo ? new Date(receiptDateTo) : null;

    if (!fromDate || Number.isNaN(fromDate.getTime()) || !toDate || Number.isNaN(toDate.getTime())) {
      toast.error('Choose a valid start and end date/time first.');
      return;
    }

    if (fromDate.getTime() > toDate.getTime()) {
      toast.error('Receipt search start time must be before the end time.');
      return;
    }

    setIsSearchingReceipts(true);
    try {
      const response = await searchSystemReceipts({
        kind: receiptKind,
        query: receiptQuery.trim(),
        dateFrom: fromDate.toISOString(),
        dateTo: toDate.toISOString(),
        limit: 60
      });
      setReceiptResults(response.receipts);
    } catch (error: any) {
      toast.error(error.message || 'Unable to search receipts');
    } finally {
      setIsSearchingReceipts(false);
    }
  };

  const requestSingleReceiptDelete = (receipt: SystemReceiptSearchResult) => {
    const receiptLabel = `${receipt.label} ${receipt.receiptNumber}`;
    setConfirmConfig({
      isOpen: true,
      title: `Delete ${receiptLabel}`,
      message: `${receipt.warning} Receipt time: ${new Date(receipt.issuedAt).toLocaleString()}. This action is irreversible.`,
      confirmLabel: 'Delete Receipt',
      type: 'danger',
      onConfirm: async () => {
        setDeletingReceiptKey(`${receipt.kind}:${receipt.id}`);
        try {
          const result = await deleteSystemReceipt({
            kind: receipt.kind,
            id: receipt.id
          });
          const deletedSummary = Object.entries(result.deleted)
            .filter(([, count]) => count > 0)
            .map(([key, count]) => `${key}: ${count}`)
            .join(', ');

          toast.success(result.message);
          if (deletedSummary) {
            toast.info(`Deleted ${deletedSummary}`);
          }
          await Promise.all([refreshSystemReport(), loadReceiptResults()]);
        } catch (error: any) {
          toast.error(error.message || 'Failed to delete the selected receipt');
        } finally {
          setDeletingReceiptKey(null);
        }
      }
    });
  };

  useEffect(() => {
    const unsubBranches = onSnapshot(
      collection(db, 'branches'),
      (snapshot) => {
        const next = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Branch));
        setBranches(next);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'branches')
    );

    const fetchSettings = async () => {
      if (!user) {
        return;
      }

      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'system'));
        if (settingsDoc.exists()) {
          const data = settingsDoc.data() as SystemSettings;
          setSettings({
            ...DEFAULT_SETTINGS,
            ...data,
            badDebtThresholdDays: data.badDebtThresholdDays || 30,
            taxRate: data.taxRate ?? 16,
            loyaltyPointRate: data.loyaltyPointRate ?? 100,
            receiptAutoPrint: data.receiptAutoPrint ?? false,
            receiptPaperWidthMm: data.receiptPaperWidthMm ?? 80,
            receiptFontSizePx: data.receiptFontSizePx ?? 12,
            receiptBrandColor: data.receiptBrandColor || DEFAULT_SETTINGS.receiptBrandColor,
            receiptSaleTitle: data.receiptSaleTitle || DEFAULT_SETTINGS.receiptSaleTitle,
            receiptRefundTitle: data.receiptRefundTitle || DEFAULT_SETTINGS.receiptRefundTitle,
            receiptCreditTitle: data.receiptCreditTitle || DEFAULT_SETTINGS.receiptCreditTitle,
            receiptExpenseTitle: data.receiptExpenseTitle || DEFAULT_SETTINGS.receiptExpenseTitle,
            receiptShiftTitle: data.receiptShiftTitle || DEFAULT_SETTINGS.receiptShiftTitle,
            receiptShowBranchName: data.receiptShowBranchName ?? true,
            receiptShowAddress: data.receiptShowAddress ?? true,
            receiptShowPhone: data.receiptShowPhone ?? true,
            receiptShowEmail: data.receiptShowEmail ?? true,
            receiptShowHeader: data.receiptShowHeader ?? true,
            receiptShowFooter: data.receiptShowFooter ?? true,
            receiptShowCashier: data.receiptShowCashier ?? true,
            receiptShowCustomer: data.receiptShowCustomer ?? true,
            receiptShowReference: data.receiptShowReference ?? true,
            receiptShowTaxLine: data.receiptShowTaxLine ?? true,
            receiptShowLoyaltySummary: data.receiptShowLoyaltySummary ?? true,
            drawerEnabled: data.drawerEnabled ?? false,
            drawerAutoOpenOnCashSale: data.drawerAutoOpenOnCashSale ?? false,
            drawerHelperUrl: data.drawerHelperUrl || DEFAULT_SETTINGS.drawerHelperUrl,
            barcodeAutofocus: data.barcodeAutofocus ?? true,
            barcodeSubmitDelayMs: data.barcodeSubmitDelayMs ?? 120
          });
        } else {
          await setDoc(doc(db, 'settings', 'system'), DEFAULT_SETTINGS);
          setSettings(DEFAULT_SETTINGS);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'settings');
      }
    };

    void fetchSettings();
    if (user) {
      void refreshSystemReport();
    }

    return () => unsubBranches();
  }, [user]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!user) {
      toast.error('You must be signed in to update settings.');
      return;
    }

    const normalizedEmail = (settings.storeEmail || '').trim();
    if (normalizedEmail && !isValidEmail(normalizedEmail)) {
      toast.error('Enter a valid store email address before saving.');
      return;
    }

    const widthValue = Number(settings.receiptPaperWidthMm ?? 80);
    if (!Number.isFinite(widthValue) || widthValue < 58 || widthValue > 120) {
      toast.error('Receipt paper width must be between 58mm and 120mm.');
      return;
    }

    const fontSizeValue = Number(settings.receiptFontSizePx ?? 12);
    if (!Number.isFinite(fontSizeValue) || fontSizeValue < 9 || fontSizeValue > 18) {
      toast.error('Receipt font size must be between 9px and 18px.');
      return;
    }

    const scannerDelayValue = Number(settings.barcodeSubmitDelayMs ?? 120);
    if (!Number.isFinite(scannerDelayValue) || scannerDelayValue < 60) {
      toast.error('Scanner auto-submit delay must be at least 60ms.');
      return;
    }

    setIsSaving(true);
    try {
      const updatedSettings = {
        ...settings,
        businessName: (settings.businessName || '').trim() || 'KingKush Sale',
        storeAddress: (settings.storeAddress || '').trim(),
        storePhone: (settings.storePhone || '').trim(),
        storeEmail: normalizedEmail,
        receiptHeader: (settings.receiptHeader || '').trim() || DEFAULT_SETTINGS.receiptHeader,
        receiptFooter: (settings.receiptFooter || '').trim() || DEFAULT_SETTINGS.receiptFooter,
        receiptPaperWidthMm: clamp(widthValue, 58, 120),
        receiptFontSizePx: clamp(fontSizeValue, 9, 18),
        receiptBrandColor: normalizeColor(settings.receiptBrandColor || '', DEFAULT_SETTINGS.receiptBrandColor || '#4f46e5'),
        receiptSaleTitle: (settings.receiptSaleTitle || '').trim() || DEFAULT_SETTINGS.receiptSaleTitle,
        receiptRefundTitle: (settings.receiptRefundTitle || '').trim() || DEFAULT_SETTINGS.receiptRefundTitle,
        receiptCreditTitle: (settings.receiptCreditTitle || '').trim() || DEFAULT_SETTINGS.receiptCreditTitle,
        receiptExpenseTitle: (settings.receiptExpenseTitle || '').trim() || DEFAULT_SETTINGS.receiptExpenseTitle,
        receiptShiftTitle: (settings.receiptShiftTitle || '').trim() || DEFAULT_SETTINGS.receiptShiftTitle,
        receiptShowBranchName: settings.receiptShowBranchName ?? true,
        receiptShowAddress: settings.receiptShowAddress ?? true,
        receiptShowPhone: settings.receiptShowPhone ?? true,
        receiptShowEmail: settings.receiptShowEmail ?? true,
        receiptShowHeader: settings.receiptShowHeader ?? true,
        receiptShowFooter: settings.receiptShowFooter ?? true,
        receiptShowCashier: settings.receiptShowCashier ?? true,
        receiptShowCustomer: settings.receiptShowCustomer ?? true,
        receiptShowReference: settings.receiptShowReference ?? true,
        receiptShowTaxLine: settings.receiptShowTaxLine ?? true,
        receiptShowLoyaltySummary: settings.receiptShowLoyaltySummary ?? true,
        drawerEnabled: Boolean(settings.drawerEnabled),
        drawerAutoOpenOnCashSale: Boolean(settings.drawerAutoOpenOnCashSale),
        drawerHelperUrl: (settings.drawerHelperUrl || DEFAULT_SETTINGS.drawerHelperUrl || '').trim() || DEFAULT_SETTINGS.drawerHelperUrl,
        barcodeSubmitDelayMs: Math.max(60, scannerDelayValue),
        updatedAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'settings', 'system'), updatedSettings);
      setSettings(updatedSettings);
      setShowSuccess(true);
      toast.success('Settings saved successfully.');
      setTimeout(() => setShowSuccess(false), 3000);
      void refreshSystemReport();

      try {
        await recordAuditLog(
          user.uid,
          user.displayName || user.username,
          'UPDATE_SETTINGS',
          'Updated store profile, scanner behavior, receipt settings, cash drawer integration, and business rules'
        );
      } catch (auditError) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Settings audit log failed', auditError);
        }
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Failed to save settings', error);
      }
      toast.error(error instanceof Error ? error.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordChange = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }

    if (!currentPassword) {
      setPasswordError('Please enter your current password');
      return;
    }

    setIsChangingPassword(true);
    try {
      await changePassword({
        currentPassword,
        newPassword
      });

      await recordAuditLog(user!.uid, user!.displayName || user!.username, 'CHANGE_PASSWORD', 'User changed their account password');

      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(false), 5000);
    } catch (error: any) {
      setPasswordError(error.message || 'Failed to change password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDrawerTest = async () => {
    if (!settings.drawerEnabled) {
      return;
    }

    setIsTestingDrawer(true);
    try {
      await testCashDrawer(settings);
      toast.success('Drawer test signal sent');
      try {
        await recordAuditLog(
          user!.uid,
          user!.displayName || user!.username,
          'TEST_CASH_DRAWER',
          `Sent cash drawer test trigger to ${settings.drawerHelperUrl || DEFAULT_SETTINGS.drawerHelperUrl}`
        );
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Drawer test audit log failed', error);
        }
      }
    } finally {
      setIsTestingDrawer(false);
    }
  };

  const requestHistoryPurge = (
    scope: 'sales' | 'cash-shifts' | 'inventory' | 'expenses' | 'audit' | 'purchase-orders' | 'label-history' | 'all',
    label: string,
    warning: string
  ) => {
    setConfirmConfig({
      isOpen: true,
      title: `Delete ${label}`,
      message: `${warning} This action is irreversible and should only be used after exports or backups are complete.`,
      confirmLabel: 'Delete History',
      type: 'danger',
      onConfirm: async () => {
        setPurgingScopeId(scope);
        try {
          const result = await purgeSystemHistory({ scope });
          const deletedSummary = Object.entries(result.deleted)
            .filter(([, count]) => count > 0)
            .map(([key, count]) => `${key}: ${count}`)
            .join(', ');
          toast.success(`Cleanup complete for ${label}`);
          if (deletedSummary) {
            toast.info(`Deleted ${deletedSummary}`);
          }
          void refreshSystemReport();
        } catch (error: any) {
          toast.error(error.message || 'Failed to delete history');
        } finally {
          setPurgingScopeId(null);
        }
      }
    });
  };

  return (
    <div className="route-workspace max-w-5xl mx-auto space-y-8">
      <ConfirmDialog
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmLabel={confirmConfig.confirmLabel}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig((current) => ({ ...current, isOpen: false }))}
        type={confirmConfig.type}
      />
      <div className="route-header flex flex-col gap-1">
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">Manage account security, branch defaults, receipt appearance, scanner behavior, cash drawer integration, and controlled history cleanup.</p>
      </div>

      <div className="route-body desktop-scroll pr-1 custom-scrollbar">
      <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-3xl flex items-center justify-center">
            <UserIcon className="w-10 h-10" />
          </div>
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-gray-900">{user?.displayName}</h2>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-bold uppercase tracking-wider">
                {user?.role}
              </span>
              <span className="text-sm text-gray-500 font-medium">@{user?.username}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
        <div className="space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-gray-50">
            <Shield className="w-5 h-5 text-indigo-600" />
            <h2 className="text-xl font-bold text-gray-900">Security & Account</h2>
          </div>

          <form onSubmit={handlePasswordChange} className="space-y-6">
            <div className="flex items-center gap-2 text-sm font-bold text-gray-600 uppercase tracking-wider">
              <Key className="w-4 h-4" />
              Change Password
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <PasswordField
                label="Current Password"
                value={currentPassword}
                onChange={setCurrentPassword}
                visible={showCurrentPassword}
                onToggle={() => setShowCurrentPassword((current) => !current)}
              />
              <PasswordField
                label="New Password"
                value={newPassword}
                onChange={setNewPassword}
                visible={showNewPassword}
                onToggle={() => setShowNewPassword((current) => !current)}
              />
              <PasswordField
                label="Confirm New Password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                visible={showConfirmPassword}
                onToggle={() => setShowConfirmPassword((current) => !current)}
              />
            </div>

            {passwordError && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 p-4 rounded-2xl">
                <AlertCircle className="w-5 h-5" />
                <span className="text-sm font-medium">{passwordError}</span>
              </div>
            )}

            {passwordSuccess && (
              <div className="flex items-center gap-2 text-green-600 bg-green-50 p-4 rounded-2xl">
                <CheckCircle className="w-5 h-5" />
                <span className="text-sm font-medium">Password changed successfully!</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isChangingPassword}
              className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:bg-gray-300"
            >
              {isChangingPassword ? 'Changing...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>

      <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
        <form onSubmit={handleSave} noValidate className="space-y-10">
          <section className="space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-gray-50">
              <Store className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-gray-900">Store Profile & Branch Defaults</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <LabeledField label="Business Name">
                <input
                  type="text"
                  value={settings.businessName || ''}
                  onChange={(event) => setSettings({ ...settings, businessName: event.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </LabeledField>

              <LabeledField label="Default Branch">
                <select
                  value={settings.defaultBranchId || ''}
                  onChange={(event) => setSettings({ ...settings, defaultBranchId: event.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} ({branch.code})
                    </option>
                  ))}
                </select>
              </LabeledField>

              <LabeledField label="Store Phone">
                <input
                  type="text"
                  value={settings.storePhone || ''}
                  onChange={(event) => setSettings({ ...settings, storePhone: event.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </LabeledField>

              <LabeledField label="Store Email">
                <input
                  type="email"
                  value={settings.storeEmail || ''}
                  onChange={(event) => setSettings({ ...settings, storeEmail: event.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </LabeledField>
            </div>

            <LabeledField label="Store Address">
              <textarea
                value={settings.storeAddress || ''}
                onChange={(event) => setSettings({ ...settings, storeAddress: event.target.value })}
                className="w-full min-h-28 p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              />
            </LabeledField>
          </section>

          <section className="space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-gray-50">
              <Printer className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-gray-900">Receipt Layout</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <LabeledField label="Paper Width (mm)">
                <input
                  type="number"
                  min="58"
                  max="120"
                  value={settings.receiptPaperWidthMm ?? 80}
                  onChange={(event) => setSettings({ ...settings, receiptPaperWidthMm: parseInt(event.target.value, 10) || 80 })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                />
              </LabeledField>
              <LabeledField label="Base Font Size (px)">
                <input
                  type="number"
                  min="9"
                  max="18"
                  value={settings.receiptFontSizePx ?? 12}
                  onChange={(event) => setSettings({ ...settings, receiptFontSizePx: parseInt(event.target.value, 10) || 12 })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                />
              </LabeledField>
              <LabeledField label="Brand Color">
                <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <input
                    type="color"
                    value={settings.receiptBrandColor || DEFAULT_SETTINGS.receiptBrandColor}
                    onChange={(event) => setSettings({ ...settings, receiptBrandColor: event.target.value })}
                    className="h-10 w-14 rounded-xl border border-gray-200 bg-white p-1"
                  />
                  <input
                    type="text"
                    value={settings.receiptBrandColor || ''}
                    onChange={(event) => setSettings({ ...settings, receiptBrandColor: event.target.value })}
                    className="w-full bg-transparent font-mono outline-none"
                  />
                </div>
              </LabeledField>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <LabeledField label="Receipt Header">
                <textarea
                  value={settings.receiptHeader || ''}
                  onChange={(event) => setSettings({ ...settings, receiptHeader: event.target.value })}
                  className="w-full min-h-24 p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </LabeledField>
              <LabeledField label="Receipt Footer">
                <textarea
                  value={settings.receiptFooter || ''}
                  onChange={(event) => setSettings({ ...settings, receiptFooter: event.target.value })}
                  className="w-full min-h-24 p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </LabeledField>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              <LabeledField label="Sale Title">
                <input
                  type="text"
                  value={settings.receiptSaleTitle || ''}
                  onChange={(event) => setSettings({ ...settings, receiptSaleTitle: event.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </LabeledField>
              <LabeledField label="Refund Title">
                <input
                  type="text"
                  value={settings.receiptRefundTitle || ''}
                  onChange={(event) => setSettings({ ...settings, receiptRefundTitle: event.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </LabeledField>
              <LabeledField label="Credit Title">
                <input
                  type="text"
                  value={settings.receiptCreditTitle || ''}
                  onChange={(event) => setSettings({ ...settings, receiptCreditTitle: event.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </LabeledField>
              <LabeledField label="Expense Title">
                <input
                  type="text"
                  value={settings.receiptExpenseTitle || ''}
                  onChange={(event) => setSettings({ ...settings, receiptExpenseTitle: event.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </LabeledField>
              <LabeledField label="Shift Report Title">
                <input
                  type="text"
                  value={settings.receiptShiftTitle || ''}
                  onChange={(event) => setSettings({ ...settings, receiptShiftTitle: event.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </LabeledField>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-gray-600 uppercase tracking-wider">
                <Palette className="w-4 h-4" />
                Receipt Visibility Controls
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <ToggleField
                  label="Show Branch Name"
                  description="Print branch or till branch name on receipts."
                  checked={settings.receiptShowBranchName ?? true}
                  onChange={(checked) => setSettings({ ...settings, receiptShowBranchName: checked })}
                />
                <ToggleField
                  label="Show Address"
                  description="Print address lines from branch or system settings."
                  checked={settings.receiptShowAddress ?? true}
                  onChange={(checked) => setSettings({ ...settings, receiptShowAddress: checked })}
                />
                <ToggleField
                  label="Show Phone"
                  description="Print phone number on receipts."
                  checked={settings.receiptShowPhone ?? true}
                  onChange={(checked) => setSettings({ ...settings, receiptShowPhone: checked })}
                />
                <ToggleField
                  label="Show Email"
                  description="Print contact email if available."
                  checked={settings.receiptShowEmail ?? true}
                  onChange={(checked) => setSettings({ ...settings, receiptShowEmail: checked })}
                />
                <ToggleField
                  label="Show Header"
                  description="Show the customizable header message."
                  checked={settings.receiptShowHeader ?? true}
                  onChange={(checked) => setSettings({ ...settings, receiptShowHeader: checked })}
                />
                <ToggleField
                  label="Show Footer"
                  description="Show the customizable footer message."
                  checked={settings.receiptShowFooter ?? true}
                  onChange={(checked) => setSettings({ ...settings, receiptShowFooter: checked })}
                />
                <ToggleField
                  label="Show Cashier"
                  description="Print cashier name on receipts."
                  checked={settings.receiptShowCashier ?? true}
                  onChange={(checked) => setSettings({ ...settings, receiptShowCashier: checked })}
                />
                <ToggleField
                  label="Show Customer"
                  description="Print customer name when a customer is attached."
                  checked={settings.receiptShowCustomer ?? true}
                  onChange={(checked) => setSettings({ ...settings, receiptShowCustomer: checked })}
                />
                <ToggleField
                  label="Show Reference"
                  description="Print sale, payment or voucher references."
                  checked={settings.receiptShowReference ?? true}
                  onChange={(checked) => setSettings({ ...settings, receiptShowReference: checked })}
                />
                <ToggleField
                  label="Show Tax Line"
                  description="Include VAT/tax breakdown on receipts."
                  checked={settings.receiptShowTaxLine ?? true}
                  onChange={(checked) => setSettings({ ...settings, receiptShowTaxLine: checked })}
                />
                <ToggleField
                  label="Show Loyalty Summary"
                  description="Show earned points where relevant."
                  checked={settings.receiptShowLoyaltySummary ?? true}
                  onChange={(checked) => setSettings({ ...settings, receiptShowLoyaltySummary: checked })}
                />
                <ToggleField
                  label="Auto Print"
                  description="Print automatically after checkout on dedicated tills."
                  checked={settings.receiptAutoPrint ?? false}
                  onChange={(checked) => setSettings({ ...settings, receiptAutoPrint: checked })}
                />
              </div>
            </div>

            <label className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <div>
                <p className="text-sm font-bold text-gray-900">Receipt designer note</p>
                <p className="text-xs text-gray-500">All receipt title, color, sizing and visibility controls above apply without touching code.</p>
              </div>
              <span
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-white"
                style={{ backgroundColor: settings.receiptBrandColor || DEFAULT_SETTINGS.receiptBrandColor }}
              >
                <Printer className="h-4 w-4" />
              </span>
            </label>
          </section>

          <section className="space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-gray-50">
              <Printer className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-gray-900">Cash Drawer Integration</h2>
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-5 py-4 text-sm text-indigo-800">
              Use this with the local cashier helper running on the till PC. The helper receives a request from the browser and sends the ESC/POS drawer pulse to your network printer or drawer controller.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <label className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                <div>
                  <p className="text-sm font-bold text-gray-900">Enable cash drawer helper</p>
                  <p className="text-xs text-gray-500">Turn this on only on tills that have the local helper installed.</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.drawerEnabled ?? false}
                  onChange={(event) => setSettings({ ...settings, drawerEnabled: event.target.checked })}
                  className="h-5 w-5 accent-indigo-600"
                />
              </label>

              <label className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                <div>
                  <p className="text-sm font-bold text-gray-900">Auto-open for cash sales</p>
                  <p className="text-xs text-gray-500">Opens the drawer after sales that include a cash tender.</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.drawerAutoOpenOnCashSale ?? false}
                  onChange={(event) => setSettings({ ...settings, drawerAutoOpenOnCashSale: event.target.checked })}
                  className="h-5 w-5 accent-indigo-600"
                  disabled={!settings.drawerEnabled}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-end">
              <LabeledField label="Local Helper URL">
                <input
                  type="text"
                  value={settings.drawerHelperUrl || ''}
                  onChange={(event) => setSettings({ ...settings, drawerHelperUrl: event.target.value })}
                  placeholder={DEFAULT_SETTINGS.drawerHelperUrl}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </LabeledField>

              <button
                type="button"
                onClick={() => void handleDrawerTest()}
                disabled={!settings.drawerEnabled || isTestingDrawer}
                className="px-6 py-4 rounded-2xl border border-indigo-200 bg-white text-indigo-700 font-bold transition-all hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
              >
                {isTestingDrawer ? 'Testing...' : 'Test Drawer'}
              </button>
            </div>
          </section>

          <section className="space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-gray-50">
              <ScanLine className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-gray-900">Barcode Scanner Workflow</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <label className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                <div>
                  <p className="text-sm font-bold text-gray-900">Keep scanner input focused</p>
                  <p className="text-xs text-gray-500">Helps keyboard-mode scanners stay ready between sales.</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.barcodeAutofocus ?? true}
                  onChange={(event) => setSettings({ ...settings, barcodeAutofocus: event.target.checked })}
                  className="h-5 w-5 accent-indigo-600"
                />
              </label>

              <LabeledField label="Auto-submit delay (ms)">
                <input
                  type="number"
                  min="60"
                  step="10"
                  value={settings.barcodeSubmitDelayMs ?? 120}
                  onChange={(event) => setSettings({ ...settings, barcodeSubmitDelayMs: parseInt(event.target.value, 10) || 120 })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </LabeledField>
            </div>
          </section>

          <section className="space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-gray-50">
              <SettingsIcon className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-gray-900">Business Rules</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <LabeledField label="SKU Prefix">
                <input
                  type="text"
                  value={settings.skuPrefix}
                  onChange={(event) => setSettings({ ...settings, skuPrefix: event.target.value.toUpperCase() })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                />
              </LabeledField>

              <LabeledField label="Bad Debt Threshold (Days)">
                <input
                  type="number"
                  min="1"
                  value={settings.badDebtThresholdDays}
                  onChange={(event) => setSettings({ ...settings, badDebtThresholdDays: parseInt(event.target.value, 10) || 0 })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                />
              </LabeledField>

              <LabeledField label="VAT Rate (%)">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={settings.taxRate}
                  onChange={(event) => setSettings({ ...settings, taxRate: parseFloat(event.target.value) || 0 })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                />
              </LabeledField>

              <LabeledField label="Loyalty Point Rate (KES per 1 Point)">
                <input
                  type="number"
                  min="1"
                  value={settings.loyaltyPointRate}
                  onChange={(event) => setSettings({ ...settings, loyaltyPointRate: parseInt(event.target.value, 10) || 1 })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                />
              </LabeledField>
            </div>
          </section>

          <div className="pt-2 flex items-center gap-4">
            <button
              type="submit"
              disabled={isSaving}
              className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:bg-gray-300"
            >
              <Save className="w-5 h-5" />
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>

            {showSuccess && (
              <div className="flex items-center gap-2 text-green-600 animate-in fade-in slide-in-from-left-4">
                <CheckCircle className="w-5 h-5" />
                <span className="font-bold text-sm">Settings saved successfully!</span>
              </div>
            )}
          </div>
        </form>
      </div>

      <div className="bg-white rounded-3xl p-8 shadow-sm border border-red-100 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-red-50">
          <Trash2 className="w-5 h-5 text-red-600" />
          <div>
            <h2 className="text-xl font-bold text-gray-900">History Cleanup</h2>
            <p className="text-sm text-gray-500">Delete selected history trails without touching master records like products, branches, suppliers, or users.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          Cleanup is permanent. Use exports and reports first, then delete only the history scope you truly want to remove.
        </div>

        {isLoadingSystemReport && !systemReport ? (
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            Loading cleanup scopes...
          </div>
        ) : (
          <div className="space-y-4">
            {systemReport?.historyScopes.map((scope) => (
              <div key={scope.id} className="rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-bold text-gray-900">{scope.label}</h3>
                      <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        {scope.recordCount} record{scope.recordCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{scope.description}</p>
                    <p className="text-xs font-medium text-amber-700">{scope.warning}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => requestHistoryPurge(scope.id, scope.label, scope.warning)}
                    disabled={purgingScopeId !== null}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {purgingScopeId === scope.id ? 'Deleting...' : 'Delete History'}
                  </button>
                </div>
              </div>
            ))}

            <div className="rounded-2xl border border-red-200 bg-white px-5 py-5 space-y-5">
              <div className="flex items-start gap-3">
                <div className="mt-1 rounded-2xl bg-red-50 p-2 text-red-600">
                  <Search className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Delete One Receipt by Date & Time</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Search a specific sale, refund, credit payment, expense voucher, or closed cash shift report, then delete only that one receipt.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                <LabeledField label="Receipt Type">
                  <select
                    value={receiptKind}
                    onChange={(event) => setReceiptKind(event.target.value as 'all' | SystemReceiptKind)}
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="all">All receipt types</option>
                    <option value="sale">Sale receipts</option>
                    <option value="refund">Refund receipts</option>
                    <option value="credit-payment">Credit payment receipts</option>
                    <option value="expense">Expense vouchers</option>
                    <option value="cash-shift">Cash shift reports</option>
                  </select>
                </LabeledField>

                <LabeledField label="From">
                  <input
                    type="datetime-local"
                    value={receiptDateFrom}
                    onChange={(event) => setReceiptDateFrom(event.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                  />
                </LabeledField>

                <LabeledField label="To">
                  <input
                    type="datetime-local"
                    value={receiptDateTo}
                    onChange={(event) => setReceiptDateTo(event.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                  />
                </LabeledField>

                <LabeledField label="Search Term">
                  <input
                    type="text"
                    value={receiptQuery}
                    onChange={(event) => setReceiptQuery(event.target.value)}
                    placeholder="Receipt no, customer, cashier, ref..."
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                  />
                </LabeledField>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void loadReceiptResults()}
                  disabled={isSearchingReceipts}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Search className="h-4 w-4" />
                  {isSearchingReceipts ? 'Searching...' : 'Search Receipts'}
                </button>
                <p className="text-xs text-amber-700">
                  Use the time window first, then narrow down with a receipt number, customer name, cashier name, branch or reference.
                </p>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50">
                {isSearchingReceipts ? (
                  <div className="flex items-center gap-3 px-5 py-6 text-sm text-gray-500">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                    Searching matching receipts...
                  </div>
                ) : receiptResults.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-gray-500">
                    No matching receipts loaded yet. Set the time window you want, then click <span className="font-semibold text-gray-700">Search Receipts</span>.
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto px-3 py-3 custom-scrollbar space-y-3">
                    {receiptResults.map((receipt) => (
                      <div key={`${receipt.kind}:${receipt.id}`} className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                                {receipt.label}
                              </span>
                              <span className="rounded-full bg-gray-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                {receipt.receiptNumber}
                              </span>
                              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 border border-gray-200">
                                {new Date(receipt.issuedAt).toLocaleString()}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 gap-2 text-sm text-gray-600 md:grid-cols-2">
                              <p><span className="font-bold text-gray-900">Actor:</span> {receipt.actorName}</p>
                              <p><span className="font-bold text-gray-900">Subject:</span> {receipt.subjectName || 'N/A'}</p>
                              <p><span className="font-bold text-gray-900">Branch:</span> {receipt.branchName || 'No branch'}</p>
                              <p><span className="font-bold text-gray-900">Status:</span> {receipt.status}</p>
                              <p><span className="font-bold text-gray-900">Amount:</span> KES {receipt.amount.toLocaleString()}</p>
                              <p><span className="font-bold text-gray-900">Reference:</span> {receipt.reference || 'No reference'}</p>
                            </div>

                            <div className="rounded-2xl bg-red-50 px-4 py-3">
                              <p className="text-xs font-semibold text-gray-700">{receipt.summary || 'No extra summary available.'}</p>
                              <p className="mt-1 text-xs text-red-700">{receipt.warning}</p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => requestSingleReceiptDelete(receipt)}
                            disabled={Boolean(purgingScopeId) || deletingReceiptKey === `${receipt.kind}:${receipt.id}`}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deletingReceiptKey === `${receipt.kind}:${receipt.id}` ? 'Deleting...' : 'Delete This Receipt'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-red-200 bg-white px-5 py-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-sm font-bold text-red-700">Delete All Supported History</h3>
                  <p className="mt-1 text-sm text-gray-600">Removes sales, shifts, inventory ledger, expenses, audit trail, purchase orders, and label history in one action.</p>
                </div>
                <button
                  type="button"
                  onClick={() => requestHistoryPurge('all', 'all history', 'This will wipe every supported history group in the system.')}
                  disabled={purgingScopeId !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-200 px-5 py-3 text-sm font-bold text-red-700 transition-all hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {purgingScopeId === 'all' ? 'Deleting...' : 'Delete Everything Listed'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-indigo-50 rounded-3xl p-8 border border-indigo-100">
        <h3 className="text-lg font-bold text-indigo-900 mb-2">Production Tip</h3>
        <p className="text-sm text-indigo-700 leading-relaxed">
          Use the branch directory to create each location first, set the default branch here, and then assign every cashier to the right branch from the Users page.
        </p>
      </div>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggle
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-gray-500 uppercase">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all pr-12"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function LabeledField({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-bold text-gray-600 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
      <div>
        <p className="text-sm font-bold text-gray-900">{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 shrink-0 accent-indigo-600"
      />
    </label>
  );
}
