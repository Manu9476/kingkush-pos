import { useEffect, useMemo, useState } from 'react';
import {
  db,
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  handleFirestoreError,
  OperationType
} from '../data';
import type { Branch, SystemSettings } from '../types';
import { Building2, MapPin, Phone, Mail, Plus, PencilLine, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from './ConfirmDialog';

const EMPTY_FORM = {
  code: '',
  name: '',
  address: '',
  phone: '',
  email: '',
  status: 'active' as Branch['status']
};

export default function Branches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [defaultBranchId, setDefaultBranchId] = useState<string>('');
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    onConfirm: () => {}
  });

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'branches'),
      (snapshot) => {
        const next = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Branch));
        next.sort((left, right) => left.name.localeCompare(right.name));
        setBranches(next);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'branches')
    );

    void getDoc(doc(db, 'settings', 'system')).then((settingsDoc) => {
      if (!settingsDoc.exists()) {
        return;
      }
      const settings = settingsDoc.data() as SystemSettings;
      setDefaultBranchId(settings.defaultBranchId || '');
    });

    return () => unsub();
  }, []);

  const activeCount = useMemo(
    () => branches.filter((branch) => branch.status === 'active').length,
    [branches]
  );

  const resetForm = () => {
    setEditingBranch(null);
    setFormData(EMPTY_FORM);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const payload = {
        code: formData.code.trim().toUpperCase(),
        name: formData.name.trim(),
        address: formData.address.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim(),
        status: formData.status,
        updatedAt: new Date().toISOString()
      };

      if (!payload.code || !payload.name) {
        toast.error('Branch code and branch name are required');
        return;
      }

      if (editingBranch) {
        await updateDoc(doc(db, 'branches', editingBranch.id), payload);
        toast.success('Branch updated');
      } else {
        await addDoc(collection(db, 'branches'), {
          ...payload,
          createdAt: new Date().toISOString()
        });
        toast.success('Branch created');
      }

      resetForm();
    } catch (error) {
      handleFirestoreError(error, editingBranch ? OperationType.UPDATE : OperationType.CREATE, 'branches');
      toast.error('Unable to save branch');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (branch: Branch) => {
    setEditingBranch(branch);
    setFormData({
      code: branch.code,
      name: branch.name,
      address: branch.address || '',
      phone: branch.phone || '',
      email: branch.email || '',
      status: branch.status
    });
  };

  const handleDelete = (branch: Branch) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Branch',
      message:
        branch.id === defaultBranchId
          ? 'This branch is the current default branch. Change the default branch in Settings before deleting it.'
          : `Delete ${branch.name}? This should only be done if the branch has not gone live yet.`,
      onConfirm: async () => {
        if (branch.id === defaultBranchId) {
          toast.error('Change the default branch first');
          return;
        }

        try {
          await deleteDoc(doc(db, 'branches', branch.id));
          toast.success('Branch deleted');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'branches');
          toast.error('Unable to delete branch');
        }
      },
      type: 'danger'
    });
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <ConfirmDialog
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig((current) => ({ ...current, isOpen: false }))}
        type={confirmConfig.type}
      />

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-gray-900">Branches</h1>
        <p className="text-sm text-gray-500">Set up branch locations, contact details, and which branches are active for operations.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-gray-400">Total Branches</p>
          <p className="mt-3 text-3xl font-black text-gray-900">{branches.length}</p>
        </div>
        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-gray-400">Active</p>
          <p className="mt-3 text-3xl font-black text-emerald-600">{activeCount}</p>
        </div>
        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-gray-400">Default Branch</p>
          <p className="mt-3 text-lg font-bold text-gray-900">
            {branches.find((branch) => branch.id === defaultBranchId)?.name || 'Not configured'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-8">
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-8 py-6 border-b border-gray-50">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{editingBranch ? 'Edit Branch' : 'New Branch'}</h2>
              <p className="text-sm text-gray-500">Create stores, mini-branches, or satellite tills.</p>
            </div>
            {editingBranch && (
              <button
                onClick={resetForm}
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Cancel edit
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <label className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Branch Code</span>
                <input
                  value={formData.code}
                  onChange={(event) => setFormData((current) => ({ ...current, code: event.target.value }))}
                  placeholder="e.g. MAIN"
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Status</span>
                <select
                  value={formData.status}
                  onChange={(event) => setFormData((current) => ({ ...current, status: event.target.value as Branch['status'] }))}
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>

            <label className="space-y-2 block">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Branch Name</span>
              <input
                value={formData.name}
                onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
                placeholder="Main Branch"
                className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
            </label>

            <label className="space-y-2 block">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Address</span>
              <textarea
                value={formData.address}
                onChange={(event) => setFormData((current) => ({ ...current, address: event.target.value }))}
                placeholder="Town, street, building details"
                className="min-h-28 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Phone</span>
                <input
                  value={formData.phone}
                  onChange={(event) => setFormData((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="+254..."
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Email</span>
                <input
                  value={formData.email}
                  onChange={(event) => setFormData((current) => ({ ...current, email: event.target.value }))}
                  placeholder="branch@example.com"
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 font-bold text-white transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              {isSubmitting ? 'Saving...' : editingBranch ? 'Save Changes' : 'Create Branch'}
            </button>
          </form>
        </div>

        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-8 py-6 border-b border-gray-50">
            <h2 className="text-xl font-bold text-gray-900">Branch Directory</h2>
            <p className="text-sm text-gray-500">Review all active outlets and make sure every cashier is attached to the right branch.</p>
          </div>

          <div className="divide-y divide-gray-50 max-h-[680px] overflow-y-auto">
            {branches.map((branch) => {
              const isDefault = branch.id === defaultBranchId;
              return (
                <div key={branch.id} className="px-8 py-6">
                  <div className="flex items-start justify-between gap-6">
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                          <Building2 className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-gray-900">{branch.name}</h3>
                            <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
                              {branch.code}
                            </span>
                            {isDefault && (
                              <span className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-600">
                                Default
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-sm">
                            {branch.status === 'active' ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                            <span className={branch.status === 'active' ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                              {branch.status}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-gray-600">
                        <div className="flex items-start gap-2">
                          <MapPin className="mt-0.5 h-4 w-4 text-gray-400" />
                          <span>{branch.address || 'No address yet'}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <Phone className="mt-0.5 h-4 w-4 text-gray-400" />
                          <span>{branch.phone || 'No phone set'}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <Mail className="mt-0.5 h-4 w-4 text-gray-400" />
                          <span>{branch.email || 'No email set'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEdit(branch)}
                        className="rounded-xl bg-gray-100 p-2 text-gray-600 transition-all hover:bg-gray-200"
                        title="Edit branch"
                      >
                        <PencilLine className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(branch)}
                        className="rounded-xl bg-red-50 p-2 text-red-600 transition-all hover:bg-red-100"
                        title="Delete branch"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {branches.length === 0 && (
              <div className="px-8 py-16 text-center text-sm font-medium text-gray-400">
                No branches have been created yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
