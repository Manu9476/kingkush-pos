import React, { useState, useEffect } from 'react';
import { 
  db, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  auth,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  handleFirestoreError, 
  OperationType 
} from '../data';
import { SystemSettings } from '../types';
import { useAuth } from '../App';
import { Settings as SettingsIcon, Save, CheckCircle, Shield, Key, AlertCircle, User as UserIcon, Eye, EyeOff } from 'lucide-react';

import { recordAuditLog } from '../services/auditService';

export default function Settings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<SystemSettings>({
    id: 'system',
    skuPrefix: 'KK-',
    badDebtThresholdDays: 30,
    taxRate: 16,
    loyaltyPointRate: 100,
    updatedAt: new Date().toISOString()
  });
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Password change state
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
    const fetchSettings = async () => {
      if (!user) return;
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'system'));
        if (settingsDoc.exists()) {
          const data = settingsDoc.data() as SystemSettings;
          setSettings({
            ...data,
            badDebtThresholdDays: data.badDebtThresholdDays || 30,
            taxRate: data.taxRate ?? 16,
            loyaltyPointRate: data.loyaltyPointRate ?? 100
          });
        } else {
          // Initialize default settings
          const defaultSettings: SystemSettings = {
            id: 'system',
            skuPrefix: 'KK-',
            badDebtThresholdDays: 30,
            taxRate: 16,
            loyaltyPointRate: 100,
            updatedAt: new Date().toISOString()
          };
          await setDoc(doc(db, 'settings', 'system'), defaultSettings);
          setSettings(defaultSettings);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'settings');
      }
    };

    fetchSettings();
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const updatedSettings = {
        ...settings,
        updatedAt: new Date().toISOString()
      };
      await setDoc(doc(db, 'settings', 'system'), updatedSettings);
      await recordAuditLog(user!.uid, user!.displayName || user!.username, 'UPDATE_SETTINGS', 'Updated system configuration (VAT, Loyalty, Bad Debt thresholds)');
      setSettings(updatedSettings);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    if (!currentPassword) {
      setPasswordError('Please enter your current password');
      return;
    }

    setIsChangingPassword(true);
    try {
      const authUser = auth.currentUser;
      if (!authUser) throw new Error('User not authenticated');

      // Re-authenticate user
      const credential = EmailAuthProvider.credential(authUser.email!, currentPassword);
      await reauthenticateWithCredential(authUser, credential);

      // Update password in auth account store
      await updatePassword(authUser, newPassword);

      // Keep profile record in sync
      await updateDoc(doc(db, 'users', user!.uid), {
        password: newPassword
      });

      await recordAuditLog(user!.uid, user!.displayName || user!.username, 'CHANGE_PASSWORD', 'User changed their account password');

      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(false), 5000);
    } catch (error: any) {
      console.error('Password change error:', error);
      if (error.code === 'auth/wrong-password') {
        setPasswordError('Incorrect current password');
      } else {
        setPasswordError(error.message || 'Failed to change password');
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">Manage your account, security, and system preferences.</p>
      </div>

      {/* User Profile Info */}
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

      {/* Security Section */}
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
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">Current Password</label>
                <div className="relative">
                  <input 
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">New Password</label>
                <div className="relative">
                  <input 
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">Confirm New Password</label>
                <div className="relative">
                  <input 
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
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
        <form onSubmit={handleSave} className="space-y-8">
          <div className="space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-gray-50">
              <SettingsIcon className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-gray-900">System Configuration</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-600 uppercase tracking-wider">SKU Prefix</label>
                <input 
                  type="text"
                  value={settings.skuPrefix}
                  onChange={(e) => setSettings({ ...settings, skuPrefix: e.target.value.toUpperCase() })}
                  placeholder="e.g. KK-, SALE-"
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                />
                <p className="text-xs text-gray-500">This prefix will be prepended to all auto-generated SKUs.</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-600 uppercase tracking-wider">Bad Debt Threshold (Days)</label>
                <input 
                  type="number"
                  min="1"
                  value={settings.badDebtThresholdDays}
                  onChange={(e) => setSettings({ ...settings, badDebtThresholdDays: parseInt(e.target.value) || 0 })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                />
                <p className="text-xs text-gray-500">Number of days after which an unpaid debt is labeled as "Bad Debt".</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-600 uppercase tracking-wider">VAT Rate (%)</label>
                <input 
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={settings.taxRate}
                  onChange={(e) => setSettings({ ...settings, taxRate: parseFloat(e.target.value) || 0 })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                />
                <p className="text-xs text-gray-500">Global tax percentage applied to sales (e.g. 16 for 16% VAT).</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-600 uppercase tracking-wider">Loyalty Point Rate (KES per 1 Point)</label>
                <input 
                  type="number"
                  min="1"
                  value={settings.loyaltyPointRate}
                  onChange={(e) => setSettings({ ...settings, loyaltyPointRate: parseInt(e.target.value) || 1 })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                />
                <p className="text-xs text-gray-500">Amount spent to earn 1 loyalty point (e.g. 100 KES = 1 point).</p>
              </div>
            </div>
          </div>

          <div className="pt-4 flex items-center gap-4">
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
        <h3 className="text-lg font-bold text-indigo-900 mb-2">About SKU Generation</h3>
        <p className="text-sm text-indigo-700 leading-relaxed">
          The system generates SKUs using the following pattern: 
          <code className="mx-1 px-2 py-0.5 bg-white rounded font-mono text-indigo-900 font-bold">
            {settings.skuPrefix}[NamePrefix]-[Timestamp][Random]
          </code>.
          Changing the prefix will only affect new products created after the change.
        </p>
      </div>
    </div>
  );
}
