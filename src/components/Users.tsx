import React, { useState, useEffect } from 'react';
import { 
  db, 
  collection, 
  onSnapshot, 
  updateDoc, 
  doc, 
  deleteDoc,
  handleFirestoreError,
  OperationType,
} from '../data';
import { Branch, UserProfile } from '../types';
import { useAuth } from '../App';
import { User, Lock, CheckCircle2, XCircle, Key, Trash2, ShieldCheck, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from './ConfirmDialog';
import { changePassword, createUserAccount } from '../services/platformApi';

const AVAILABLE_PERMISSIONS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'pos', label: 'Sale' },
  { id: 'sales-history', label: 'Sales History' },
  { id: 'shifts', label: 'Cash Shifts' },
  { id: 'customers', label: 'Customers' },
  { id: 'credits', label: 'Credits' },
  { id: 'products', label: 'Products' },
  { id: 'categories', label: 'Categories' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'purchase-orders', label: 'Purchase Orders' },
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'branches', label: 'Branches' },
  { id: 'labels', label: 'Labels' },
  { id: 'reports', label: 'Reports' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'users', label: 'Users' },
  { id: 'audit-logs', label: 'Audit Logs' },
  { id: 'settings', label: 'Settings' },
  { id: 'status', label: 'System Status' },
];

const PERMISSION_LABELS = Object.fromEntries(
  AVAILABLE_PERMISSIONS.map((permission) => [permission.id, permission.label])
) as Record<string, string>;

const ROLE_PERMISSION_PRESETS: Record<
  'admin' | 'cashier',
  {
    title: string;
    description: string;
    permissions: string[];
  }
> = {
  cashier: {
    title: 'Frontline Cashier',
    description: 'Best for checkout staff handling sales, refunds, customer lookup, shift control, and credit follow-up at the till.',
    permissions: ['dashboard', 'pos', 'sales-history', 'shifts', 'customers', 'credits']
  },
  admin: {
    title: 'Store Operations Admin',
    description: 'Best for branch supervisors managing products, stock, purchasing, expenses, reports, labels, and cashier accounts.',
    permissions: [
      'dashboard',
      'pos',
      'sales-history',
      'shifts',
      'customers',
      'credits',
      'products',
      'categories',
      'inventory',
      'purchase-orders',
      'suppliers',
      'labels',
      'reports',
      'expenses',
      'users'
    ]
  }
};

function createUserFormState(currentUser: UserProfile | null | undefined, role: 'admin' | 'cashier' = 'cashier') {
  return {
    fullName: '',
    username: '',
    password: '',
    branchId: currentUser?.branchId || 'branch_main',
    role,
    permissions: [...ROLE_PERMISSION_PRESETS[role].permissions]
  };
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [formData, setFormData] = useState(() => createUserFormState(currentUser, 'cashier'));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [isChangingUserPassword, setIsChangingUserPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showCurrentPasswordModal, setShowCurrentPasswordModal] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');

  // Confirm Dialog State
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  useEffect(() => {
    if (!currentUser) return;
    const unsub = onSnapshot(collection(db, 'users'), 
      (snapshot) => setUsers(snapshot.docs.map(doc => ({ ...doc.data() } as UserProfile))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'users')
    );
    const unsubBranches = onSnapshot(
      collection(db, 'branches'),
      (snapshot) => setBranches(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Branch))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'branches')
    );
    return () => {
      unsub();
      unsubBranches();
    };
  }, [currentUser]);

  const applyRolePreset = (role: 'admin' | 'cashier') => {
    setFormData((prev) => ({
      ...prev,
      role,
      permissions: [...ROLE_PERMISSION_PRESETS[role].permissions]
    }));
  };

  const handleTogglePermission = (id: string) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(id)
        ? prev.permissions.filter(p => p !== id)
        : [...prev.permissions, id]
    }));
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (!formData.password) {
        setError('Password is required');
        setIsSubmitting(false);
        return;
      }
      if (formData.password.length < 8) {
        setError('Password must be at least 8 characters');
        setIsSubmitting(false);
        return;
      }

      if (currentUser?.role === 'admin' && formData.role !== 'cashier') {
        setError('Admins can only create cashier accounts');
        setIsSubmitting(false);
        return;
      }

      await createUserAccount({
        username: formData.username.toLowerCase(),
        password: formData.password,
        displayName: formData.fullName,
        branchId: formData.branchId,
        role: formData.role,
        permissions: formData.permissions
      });
      
      setFormData(createUserFormState(currentUser, 'cashier'));
      toast.success('User created successfully');
    } catch (err: any) {
      console.error('Create user error:', err);
      setError(err.message || 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleUserStatus = async (u: UserProfile) => {
    if (u.role === 'superadmin') return;
    try {
      await updateDoc(doc(db, 'users', u.uid), {
        status: u.status === 'active' ? 'inactive' : 'active'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'users');
    }
  };

  const updateUserBranch = async (u: UserProfile, branchId: string) => {
    try {
      await updateDoc(doc(db, 'users', u.uid), {
        branchId
      });
      toast.success('Branch updated');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'users');
    }
  };

  const handleDeleteUser = async (u: UserProfile) => {
    if (u.role === 'superadmin') return;
    
    setConfirmConfig({
      isOpen: true,
      title: 'Delete User',
      message: `Are you sure you want to delete ${u.displayName}? This action cannot be undone and will remove their access to the system.`,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'users', u.uid));
          toast.success('User deleted successfully');
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, 'users');
          toast.error('Failed to delete user');
        }
      },
      type: 'danger'
    });
  };

  const handleUpdateUserPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !newPassword) return;
    const isSelf = editingUser.uid === currentUser?.uid;

    if (isSelf && !currentPasswordInput) {
      setError('Please enter your current password to verify identity.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    setIsChangingUserPassword(true);
    setError(null);

    try {
      await changePassword({
        currentPassword: isSelf ? currentPasswordInput : undefined,
        newPassword,
        targetUserId: editingUser.uid
      });
      
      setEditingUser(null);
      setNewPassword('');
      setCurrentPasswordInput('');
      toast.success('Password updated successfully');
    } catch (err: any) {
      console.error('Update user password error:', err);
      setError(err.message || 'Failed to update user password');
    } finally {
      setIsChangingUserPassword(false);
    }
  };

  const selectedPreset = ROLE_PERMISSION_PRESETS[formData.role];

  return (
    <div className="route-workspace space-y-8">
      <ConfirmDialog
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
        type={confirmConfig.type}
      />
      <div className="route-header">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="text-gray-500">Superadmin manages admins and cashiers. Admin manages cashiers only.</p>
      </div>

      <div className="route-body">
      <div className="route-grid grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Create User Form */}
        <div className="xl:col-span-1">
          <div className="desktop-card bg-white rounded-[1.95rem] shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-8 border-b border-gray-50">
              <h2 className="text-xl font-bold text-gray-900">Create User</h2>
            </div>
            <form onSubmit={handleCreateUser} className="desktop-form-scroll p-8 space-y-6 custom-scrollbar">
              {error && (
                <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium">
                  {error}
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Full Name</label>
                  <input 
                    type="text"
                    required
                    value={formData.fullName}
                    onChange={e => setFormData(prev => ({ ...prev, fullName: e.target.value }))}
                    className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Username</label>
                  <input 
                    type="text"
                    required
                    value={formData.username}
                    onChange={e => setFormData(prev => ({ ...prev, username: e.target.value }))}
                    className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Password</label>
                  <div className="relative">
                    <input 
                      type={showPassword ? "text" : "password"}
                      required
                      value={formData.password}
                      onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
                      className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Role</label>
                  <select 
                    value={formData.role}
                    onChange={e => applyRolePreset(e.target.value as 'admin' | 'cashier')}
                    className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                  >
                    <option value="cashier">Cashier</option>
                    {currentUser?.role === 'superadmin' && <option value="admin">Admin</option>}
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border border-teal-100 bg-teal-50/70 p-4 space-y-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-teal-600">
                      Recommended Preset
                    </p>
                    <p className="text-sm font-bold text-teal-950">{selectedPreset.title}</p>
                    <p className="text-xs leading-5 text-teal-800/80">{selectedPreset.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyRolePreset(formData.role)}
                    className="inline-flex items-center justify-center rounded-xl border border-teal-200 bg-white px-4 py-2 text-xs font-bold text-teal-700 transition-all hover:bg-teal-100"
                  >
                    Reset to Preset
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedPreset.permissions.map((permissionId) => (
                    <span
                      key={permissionId}
                      className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-teal-700 shadow-sm"
                    >
                      {PERMISSION_LABELS[permissionId] || permissionId}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Branch</label>
                <select
                  value={formData.branchId}
                  onChange={e => setFormData(prev => ({ ...prev, branchId: e.target.value }))}
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                >
                  {branches.map(branch => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} ({branch.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-teal-600" />
                  Authorized Components
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {AVAILABLE_PERMISSIONS.map(p => (
                    <label 
                      key={p.id}
                      className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
                        formData.permissions.includes(p.id)
                          ? 'bg-teal-50 border-teal-200 text-teal-700'
                          : 'bg-gray-50 border-gray-100 text-gray-500 hover:border-gray-200'
                      }`}
                    >
                      <input 
                        type="checkbox"
                        className="hidden"
                        checked={formData.permissions.includes(p.id)}
                        onChange={() => handleTogglePermission(p.id)}
                      />
                      <span className="text-xs font-medium">{p.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button 
                type="submit"
                disabled={isSubmitting}
                className="w-full py-4 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 shadow-lg shadow-teal-100 transition-all disabled:opacity-50"
              >
                {isSubmitting ? 'Creating...' : 'Create User'}
              </button>
            </form>
          </div>
        </div>

        {/* Users Table */}
        <div className="xl:col-span-2">
          <div className="desktop-card bg-white rounded-[1.95rem] shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-8 border-b border-gray-50 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">System Users</h2>
              <span className="text-sm text-gray-500">Account status and role controls</span>
            </div>
            <div className="desktop-table-scroll overflow-x-auto overflow-y-auto pr-2 custom-scrollbar" style={{ maxHeight: '598px' }}>
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-white z-10 shadow-sm">
                  <tr className="bg-gray-50/50">
                    <th className="px-8 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Name</th>
                    <th className="px-8 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Username</th>
                    <th className="px-8 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Role</th>
                    <th className="px-8 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Branch</th>
                    <th className="px-8 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Status</th>
                    <th className="px-8 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {users.map(u => (
                    <tr key={u.uid} className="hover:bg-gray-50/30 transition-colors">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            u.role === 'superadmin' ? 'bg-purple-100 text-purple-600' :
                            u.role === 'admin' ? 'bg-indigo-100 text-indigo-600' : 'bg-teal-100 text-teal-600'
                          }`}>
                            <User className="w-5 h-5" />
                          </div>
                          <span className="font-bold text-gray-900">{u.displayName}</span>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-gray-600 font-medium">{u.username}</td>
                      <td className="px-8 py-6">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          u.role === 'superadmin' ? 'bg-purple-50 text-purple-600' :
                          u.role === 'admin' ? 'bg-indigo-50 text-indigo-600' : 'bg-teal-50 text-teal-600'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <select
                          value={u.branchId || 'branch_main'}
                          onChange={(event) => updateUserBranch(u, event.target.value)}
                          className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-teal-500"
                        >
                          {branches.map(branch => (
                            <option key={branch.id} value={branch.id}>
                              {branch.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-2">
                          {u.status === 'active' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-500" />
                          )}
                          <span className={`text-sm font-medium ${u.status === 'active' ? 'text-emerald-600' : 'text-red-600'}`}>
                            {u.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex justify-end gap-2">
                          {u.role !== 'superadmin' && (
                            <button 
                              onClick={() => toggleUserStatus(u)}
                              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                                u.status === 'active' 
                                  ? 'bg-red-50 text-red-600 hover:bg-red-100' 
                                  : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                              }`}
                            >
                              {u.status === 'active' ? 'Deactivate' : 'Activate'}
                            </button>
                          )}
                          
                          {(currentUser?.role === 'superadmin' || (currentUser?.role === 'admin' && u.role === 'cashier')) && (
                            <button 
                              onClick={() => {
                                setEditingUser(u);
                                setError(null);
                                setNewPassword('');
                                setCurrentPasswordInput('');
                              }}
                              className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                              title="Change Password"
                            >
                              <Key className="w-4 h-4" />
                            </button>
                          )}

                          {u.role !== 'superadmin' && (
                            <button 
                              onClick={() => handleDeleteUser(u)}
                              className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100"
                              title="Delete User"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* Change Password Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[1.95rem] shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-8 border-b border-gray-50 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Change Password</h2>
                <p className="text-sm text-gray-500">Updating password for @{editingUser.username}</p>
              </div>
              <button 
                onClick={() => {
                  setEditingUser(null);
                  setError(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
              >
                <XCircle className="w-6 h-6 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleUpdateUserPassword} className="p-8 space-y-6">
              {error && (
                <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}

              {editingUser.uid === currentUser?.uid && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Current Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input 
                      type={showCurrentPasswordModal ? "text" : "password"}
                      required
                      value={currentPasswordInput}
                      onChange={e => setCurrentPasswordInput(e.target.value)}
                      className="w-full pl-12 pr-12 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                      placeholder="Enter current password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPasswordModal(!showCurrentPasswordModal)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showCurrentPasswordModal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">New Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input 
                    type={showNewPassword ? "text" : "password"}
                    required
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="w-full pl-12 pr-12 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                    placeholder="Enter new password"
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
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => {
                    setEditingUser(null);
                    setError(null);
                  }}
                  className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={isChangingUserPassword || !newPassword}
                  className="flex-1 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 shadow-lg shadow-teal-100 transition-all disabled:opacity-50"
                >
                  {isChangingUserPassword ? 'Updating...' : 'Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
