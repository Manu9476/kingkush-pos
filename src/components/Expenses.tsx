import React, { useState, useEffect } from 'react';
import {
  db,
  collection,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  handleFirestoreError,
  OperationType,
  toDate
} from '../data';
import { Branch, Expense, ExpenseCategory, SystemSettings } from '../types';
import { useAuth } from '../App';
import { 
  Plus, 
  Search, 
  Printer, 
  Tag, 
  FileText,
  X,
  TrendingDown,
  Receipt,
  Settings2,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import ConfirmDialog from './ConfirmDialog';
import { createExpense } from '../services/platformApi';
import { getReceiptAppearance, getReceiptContainerStyle, getReceiptIdentity, resolveReceiptBranch } from '../utils/receipts';

const PAYMENT_METHODS = ['cash', 'mpesa', 'bank', 'other'] as const;

export default function Expenses() {
  const { user } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [, setIsPrinting] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);

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

  // Form state
  const [formData, setFormData] = useState({
    category: '',
    description: '',
    amount: '',
    paymentMethod: 'cash' as Expense['paymentMethod'],
    reference: ''
  });

  const [newCategory, setNewCategory] = useState({
    name: '',
    description: ''
  });

  useEffect(() => {
    const q = query(collection(db, 'expenses'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, 
      (snapshot) => {
        setExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense)));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'expenses')
    );

    const catQ = query(collection(db, 'expense_categories'), orderBy('name', 'asc'));
    const unsubCats = onSnapshot(catQ,
      (snapshot) => {
        const fetchedCats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseCategory));
        setCategories(fetchedCats);
        if (fetchedCats.length > 0 && !formData.category) {
          setFormData(prev => ({ ...prev, category: fetchedCats[0].name }));
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'expense_categories')
    );

    const unsubBranches = onSnapshot(collection(db, 'branches'),
      (snapshot) => {
        setBranches(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Branch)));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'branches')
    );

    const fetchSettings = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'system'));
        if (settingsDoc.exists()) {
          setSettings(settingsDoc.data() as SystemSettings);
        }
      } catch (error) {
        console.error('Error fetching settings:', error);
      }
    };

    void fetchSettings();

    return () => {
      unsub();
      unsubCats();
      unsubBranches();
    };
  }, []);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      await createExpense({
        category: formData.category,
        description: formData.description,
        amount: parseFloat(formData.amount),
        paymentMethod: formData.paymentMethod,
        reference: formData.reference || undefined
      });
      setIsModalOpen(false);
      setFormData({
        category: categories[0]?.name || '',
        description: '',
        amount: '',
        paymentMethod: 'cash',
        reference: ''
      });
      toast.success('Expense recorded successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'expenses');
      toast.error('Failed to record expense');
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategory.name.trim()) return;

    try {
      await addDoc(collection(db, 'expense_categories'), {
        ...newCategory,
        createdAt: serverTimestamp()
      });
      setNewCategory({ name: '', description: '' });
      setIsCategoryModalOpen(false);
      toast.success('Category added successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'expense_categories');
      toast.error('Failed to add category');
    }
  };

  const handleDeleteCategory = async (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Category',
      message: 'Are you sure you want to delete this category? This will not delete existing expenses in this category.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'expense_categories', id));
          toast.success('Category deleted successfully');
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, 'expense_categories');
          toast.error('Failed to delete category');
        }
      },
      type: 'danger'
    });
  };

  const handlePrint = (expense: Expense) => {
    setSelectedExpense(expense);
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 1000);
  };

  const filteredExpenses = expenses.filter(exp => {
    const matchesSearch = exp.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         exp.recordedByName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         exp.reference?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || exp.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const totalExpenses = filteredExpenses.reduce((sum, exp) => sum + exp.amount, 0);
  const expenseReceiptBranch = resolveReceiptBranch(branches, selectedExpense?.branchId, settings?.defaultBranchId);
  const expenseReceiptIdentity = getReceiptIdentity(settings, expenseReceiptBranch);
  const expenseReceiptAppearance = getReceiptAppearance(settings);

  return (
    <div className="route-workspace p-6 space-y-8 max-w-7xl mx-auto">
      <ConfirmDialog
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
        type={confirmConfig.type}
      />
      {/* Header Section */}
      <div className="route-header flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">SHOP EXPENSES</h1>
          <p className="text-gray-500 font-medium">Track and monitor all shop expenditures</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setIsCategoryModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 px-6 py-3 rounded-2xl font-bold transition-all hover:bg-gray-50 active:scale-95 shadow-sm"
          >
            <Settings2 className="w-5 h-5" />
            Manage Categories
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-2xl font-bold transition-all shadow-lg shadow-indigo-200 active:scale-95"
          >
            <Plus className="w-5 h-5" />
            Record New Expense
          </button>
        </div>
      </div>

      <div className="route-body desktop-scroll pr-1 custom-scrollbar">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-4xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center">
            <TrendingDown className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Total Expenses</p>
            <p className="text-2xl font-black text-gray-900">KES {totalExpenses.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-4xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Total Records</p>
            <p className="text-2xl font-black text-gray-900">{filteredExpenses.length}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-4xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center">
            <Tag className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Active Categories</p>
            <p className="text-2xl font-black text-gray-900">{new Set(filteredExpenses.map(e => e.category)).size}</p>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white p-6 rounded-4xl border border-gray-100 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input 
              type="text"
              placeholder="Search expenses by description, reference or recorder..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-medium"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
            <button 
              onClick={() => setSelectedCategory('All')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                selectedCategory === 'All' ? 'bg-indigo-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
              }`}
            >
              All
            </button>
            {categories.map(cat => (
              <button 
                key={cat.id}
                onClick={() => setSelectedCategory(cat.name)}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                  selectedCategory === cat.name ? 'bg-indigo-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Expenses Table */}
      <div className="desktop-card bg-white rounded-4xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="desktop-table-scroll overflow-x-auto max-h-150 overflow-y-auto pr-2 custom-scrollbar">
          <table className="w-full">
            <thead className="sticky top-0 bg-white z-10 shadow-sm">
              <tr className="text-left border-b border-gray-50">
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Date</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Category</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Description</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Method</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Amount</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredExpenses.map((expense) => (
                <tr key={expense.id} className="group hover:bg-gray-50 transition-colors">
                  <td className="p-6">
                    <p className="text-sm font-bold text-gray-900">{toDate(expense.date).toLocaleDateString()}</p>
                    <p className="text-[10px] font-bold text-gray-400">{toDate(expense.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                  </td>
                  <td className="p-6">
                    <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                      {expense.category}
                    </span>
                  </td>
                  <td className="p-6">
                    <p className="text-sm font-bold text-gray-900">{expense.description}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">By: {expense.recordedByName}</p>
                  </td>
                  <td className="p-6">
                    <span className="text-xs font-bold text-gray-500 uppercase">{expense.paymentMethod}</span>
                    {expense.reference && <p className="text-[10px] font-mono text-gray-400">Ref: {expense.reference}</p>}
                  </td>
                  <td className="p-6 text-right">
                    <p className="text-sm font-black text-gray-900">KES {expense.amount.toLocaleString()}</p>
                  </td>
                  <td className="p-6 text-right">
                    <button 
                      onClick={() => handlePrint(expense)}
                      className="p-2 bg-gray-100 text-gray-600 rounded-xl hover:bg-indigo-600 hover:text-white transition-all"
                      title="Print Voucher"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredExpenses.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <FileText className="w-12 h-12 text-gray-200" />
                      <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">No expense records found</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>

      {/* Add Expense Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black text-gray-900 tracking-tight">RECORD EXPENSE</h2>
                  <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                    <X className="w-6 h-6 text-gray-400" />
                  </button>
                </div>

                <form onSubmit={handleAddExpense} className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Category</label>
                      <button 
                        type="button"
                        onClick={() => {
                          setIsModalOpen(false);
                          setIsCategoryModalOpen(true);
                        }}
                        className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest hover:underline"
                      >
                        + Add New
                      </button>
                    </div>
                    <select 
                      required
                      value={formData.category}
                      onChange={(e) => setFormData({...formData, category: e.target.value})}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-bold text-gray-700"
                    >
                      <option value="" disabled>Select a category</option>
                      {categories.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Description</label>
                    <textarea 
                      required
                      placeholder="What was this spending for?"
                      value={formData.description}
                      onChange={(e) => setFormData({...formData, description: e.target.value})}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-medium min-h-25"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Amount (KES)</label>
                      <input 
                        required
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={formData.amount}
                        onChange={(e) => setFormData({...formData, amount: e.target.value})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-black text-gray-900"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Payment Method</label>
                      <select 
                        required
                        value={formData.paymentMethod}
                        onChange={(e) => setFormData({...formData, paymentMethod: e.target.value as Expense['paymentMethod']})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-bold text-gray-700"
                      >
                        {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Reference (Optional)</label>
                    <input 
                      type="text"
                      placeholder="Receipt #, Transaction ID, etc."
                      value={formData.reference}
                      onChange={(e) => setFormData({...formData, reference: e.target.value})}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-medium"
                    />
                  </div>

                  <button 
                    type="submit"
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 active:scale-95 pt-4 mt-4"
                  >
                    Save Expense Record
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Category Management Modal */}
      <AnimatePresence>
        {isCategoryModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCategoryModalOpen(false)}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 space-y-8">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black text-gray-900 tracking-tight">EXPENSE CATEGORIES</h2>
                  <button onClick={() => setIsCategoryModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                    <X className="w-6 h-6 text-gray-400" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Add Category Form */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">Create New</h3>
                    <form onSubmit={handleAddCategory} className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Category Name</label>
                        <input 
                          required
                          type="text"
                          placeholder="e.g., Rent, Salaries"
                          value={newCategory.name}
                          onChange={(e) => setNewCategory({...newCategory, name: e.target.value})}
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-bold"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Description (Optional)</label>
                        <input 
                          type="text"
                          placeholder="Briefly describe this category"
                          value={newCategory.description}
                          onChange={(e) => setNewCategory({...newCategory, description: e.target.value})}
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-medium"
                        />
                      </div>
                      <button 
                        type="submit"
                        className="w-full py-3 bg-indigo-600 text-white rounded-2xl font-bold uppercase tracking-widest hover:bg-indigo-700 transition-all active:scale-95"
                      >
                        Add Category
                      </button>
                    </form>
                  </div>

                  {/* Categories List */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">Existing Categories</h3>
                    <div className="space-y-2 max-h-75 overflow-y-auto pr-2">
                      {categories.map(cat => (
                        <div key={cat.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl group">
                          <div>
                            <p className="text-sm font-bold text-gray-900">{cat.name}</p>
                            {cat.description && <p className="text-[10px] text-gray-500">{cat.description}</p>}
                          </div>
                          <button 
                            onClick={() => handleDeleteCategory(cat.id)}
                            className="p-2 text-gray-400 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      {categories.length === 0 && (
                        <p className="text-center py-8 text-xs font-bold text-gray-400 uppercase tracking-widest">No categories yet</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Hidden Print Voucher */}
      {selectedExpense && (
        <div id="expense-voucher" className="hidden print:block font-mono leading-tight" style={getReceiptContainerStyle(settings)}>
          <div className="text-center mb-6">
            <p className="font-bold mb-1 uppercase" style={{ color: expenseReceiptAppearance.brandColor }}>{expenseReceiptAppearance.expenseTitle}</p>
            <h1 className="font-bold text-lg uppercase">{expenseReceiptIdentity.businessName}</h1>
            {expenseReceiptAppearance.showBranchName && expenseReceiptIdentity.branchName && <p className="text-sm">{expenseReceiptIdentity.branchName}</p>}
            {expenseReceiptAppearance.showAddress && expenseReceiptIdentity.address && <p className="text-sm">{expenseReceiptIdentity.address}</p>}
            {expenseReceiptAppearance.showPhone && expenseReceiptIdentity.phone && <p className="text-sm">Tel: {expenseReceiptIdentity.phone}</p>}
            {expenseReceiptAppearance.showEmail && expenseReceiptIdentity.email && <p className="text-sm">{expenseReceiptIdentity.email}</p>}
            <p className="mt-2">********************************</p>
          </div>
          
          <div className="space-y-2 mb-6">
            <div className="flex justify-between">
              <span>DATE:</span>
              <span>{toDate(selectedExpense.date).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span>TIME:</span>
              <span>{toDate(selectedExpense.date).toLocaleTimeString()}</span>
            </div>
            <div className="flex justify-between">
              <span>VOUCHER #:</span>
              <span>{selectedExpense.id.slice(-8).toUpperCase()}</span>
            </div>
            <div className="flex justify-between">
              <span>CATEGORY:</span>
              <span>{selectedExpense.category.toUpperCase()}</span>
            </div>
          </div>

          <div className="border-y border-dashed border-gray-300 py-4 mb-6">
            <p className="font-bold mb-2 uppercase tracking-widest text-[10px]">Description:</p>
            <p className="italic">{selectedExpense.description}</p>
          </div>

          <div className="space-y-2 mb-8">
            <div className="flex justify-between font-bold text-sm">
              <span>TOTAL AMOUNT:</span>
              <span>KES {selectedExpense.amount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>PAID VIA:</span>
              <span>{selectedExpense.paymentMethod.toUpperCase()}</span>
            </div>
            {selectedExpense.reference && (
              <div className="flex justify-between">
                <span>REFERENCE:</span>
                <span>{selectedExpense.reference}</span>
              </div>
            )}
          </div>

          <div className="space-y-6 mt-12">
            <div className="border-t border-gray-300 pt-1">
              <p className="text-[10px] uppercase tracking-widest text-center">Recorded By: {selectedExpense.recordedByName}</p>
            </div>
            <div className="border-t border-gray-300 pt-4 mt-8">
              <p className="text-[10px] uppercase tracking-widest text-center">Authorized Signature</p>
            </div>
          </div>

          <div className="text-center mt-12 text-[10px]">
            <p>********************************</p>
            {expenseReceiptAppearance.showHeader && <p className="font-bold mb-1 uppercase">{expenseReceiptIdentity.header}</p>}
            <p>INTERNAL SHOP DOCUMENT</p>
            {expenseReceiptAppearance.showFooter && <p>{expenseReceiptIdentity.footer}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
