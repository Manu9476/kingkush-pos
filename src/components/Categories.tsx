import React, { useState, useEffect } from 'react';
import { 
  db, 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  handleFirestoreError,
  OperationType
} from '../data';
import { Category } from '../types';
import { useAuth } from '../App';
import { Plus, Edit2, Trash2, Folder, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from './ConfirmDialog';

export default function Categories() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '' });

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
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'categories'), 
      (snapshot) => setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'categories')
    );
    return () => unsub();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingCategory) {
        await updateDoc(doc(db, 'categories', editingCategory.id), formData);
        toast.success('Category updated');
      } else {
        await addDoc(collection(db, 'categories'), formData);
        toast.success('Category created');
      }
      setIsModalOpen(false);
      setFormData({ name: '', description: '' });
      setEditingCategory(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'categories');
      toast.error('Failed to save category');
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Category',
      message: 'Are you sure? This might affect products in this category. This action cannot be undone.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'categories', id));
          toast.success('Category deleted');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'categories');
          toast.error('Failed to delete category');
        }
      },
      type: 'danger'
    });
  };

  return (
    <div className="space-y-8">
      <ConfirmDialog
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
        type={confirmConfig.type}
      />
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
          <p className="text-gray-500">Organize your supermarket products.</p>
        </div>
        <button 
          onClick={() => { setIsModalOpen(true); setEditingCategory(null); setFormData({ name: '', description: '' }); }}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all"
        >
          <Plus className="w-5 h-5" />
          Add Category
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {categories.map(cat => (
          <div key={cat.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 group hover:border-indigo-200 transition-all">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                <Folder className="w-6 h-6" />
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => { setEditingCategory(cat); setFormData({ name: cat.name, description: cat.description || '' }); setIsModalOpen(true); }}
                  className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => handleDelete(cat.id)}
                  className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <h3 className="text-lg font-bold text-gray-900">{cat.name}</h3>
            <p className="text-sm text-gray-500 mt-1">{cat.description || 'No description provided.'}</p>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-4xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95">
            <div className="p-8 border-b border-gray-50">
              <h2 className="text-2xl font-bold text-gray-900">{editingCategory ? 'Edit Category' : 'New Category'}</h2>
            </div>
            <form onSubmit={handleSubmit} className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Category Name</label>
                <input 
                  required
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                  placeholder="e.g., Beverages"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Description</label>
                <textarea 
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all h-32 resize-none"
                  placeholder="Brief description of the category..."
                />
              </div>
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all"
                >
                  {editingCategory ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
