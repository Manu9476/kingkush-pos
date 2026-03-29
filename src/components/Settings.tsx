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
  ScanLine
} from 'lucide-react';

import { recordAuditLog } from '../services/auditService';
import { testCashDrawer } from '../services/cashDrawer';
import { changePassword } from '../services/platformApi';

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

    return () => unsubBranches();
  }, [user]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const updatedSettings = {
        ...settings,
        businessName: (settings.businessName || '').trim() || 'KingKush Sale',
        storeAddress: (settings.storeAddress || '').trim(),
        storePhone: (settings.storePhone || '').trim(),
        storeEmail: (settings.storeEmail || '').trim(),
        receiptHeader: (settings.receiptHeader || '').trim() || DEFAULT_SETTINGS.receiptHeader,
        receiptFooter: (settings.receiptFooter || '').trim() || DEFAULT_SETTINGS.receiptFooter,
        drawerEnabled: Boolean(settings.drawerEnabled),
        drawerAutoOpenOnCashSale: Boolean(settings.drawerAutoOpenOnCashSale),
        drawerHelperUrl: (settings.drawerHelperUrl || DEFAULT_SETTINGS.drawerHelperUrl || '').trim() || DEFAULT_SETTINGS.drawerHelperUrl,
        barcodeSubmitDelayMs: Math.max(60, Number(settings.barcodeSubmitDelayMs || 120)),
        updatedAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'settings', 'system'), updatedSettings);
      await recordAuditLog(
        user!.uid,
        user!.displayName || user!.username,
        'UPDATE_SETTINGS',
        'Updated store profile, scanner behavior, receipt settings, cash drawer integration, and business rules'
      );
      setSettings(updatedSettings);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings');
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

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">Manage account security, branch defaults, receipt identity, scanner behavior, and cash drawer integration.</p>
      </div>

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
        <form onSubmit={handleSave} className="space-y-10">
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

            <label className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <div>
                <p className="text-sm font-bold text-gray-900">Auto-print receipts after checkout</p>
                <p className="text-xs text-gray-500">Useful on dedicated cashier terminals with thermal printers.</p>
              </div>
              <input
                type="checkbox"
                checked={settings.receiptAutoPrint ?? false}
                onChange={(event) => setSettings({ ...settings, receiptAutoPrint: event.target.checked })}
                className="h-5 w-5 accent-indigo-600"
              />
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

      <div className="bg-indigo-50 rounded-3xl p-8 border border-indigo-100">
        <h3 className="text-lg font-bold text-indigo-900 mb-2">Production Tip</h3>
        <p className="text-sm text-indigo-700 leading-relaxed">
          Use the branch directory to create each location first, set the default branch here, and then assign every cashier to the right branch from the Users page.
        </p>
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
