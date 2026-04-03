import { useState, useEffect } from 'react';
import { 
  db, 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query,
  where,
  orderBy,
  handleFirestoreError,
  OperationType
} from '../data';
import { Supplier } from '../types';
import { useAuth } from '../App';
import { Plus, Edit2, Trash2, Truck, Phone, Mail, User, History, X, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from './ConfirmDialog';

export default function Suppliers() {
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierOrders, setSupplierOrders] = useState<any[]>([]);
  const [formData, setFormData] = useState({ name: '', contactPerson: '', phone: '', email: '' });

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
    const unsub = onSnapshot(collection(db, 'suppliers'), 
      (snapshot) => setSuppliers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'suppliers')
    );
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (selectedSupplier) {
      const q = query(
        collection(db, 'purchase_orders'),
        where('supplierId', '==', selectedSupplier.id),
        orderBy('createdAt', 'desc')
      );
      const unsub = onSnapshot(q, (snapshot) => {
        setSupplierOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (err) => handleFirestoreError(err, OperationType.LIST, 'purchase_orders'));
      return () => unsub();
    }
  }, [selectedSupplier]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingSupplier) {
        await updateDoc(doc(db, 'suppliers', editingSupplier.id), formData);
        toast.success('Supplier updated');
      } else {
        await addDoc(collection(db, 'suppliers'), formData);
        toast.success('Supplier created');
      }
      setIsModalOpen(false);
      setFormData({ name: '', contactPerson: '', phone: '', email: '' });
      setEditingSupplier(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'suppliers');
      toast.error('Failed to save supplier');
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Supplier',
      message: 'Are you sure you want to delete this supplier? This action cannot be undone.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'suppliers', id));
          toast.success('Supplier deleted');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'suppliers');
          toast.error('Failed to delete supplier');
        }
      },
      type: 'danger'
    });
  };

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
      <div className="route-header flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
          <p className="text-gray-500">Manage your supermarket's supply chain.</p>
        </div>
        <button 
          onClick={() => { setIsModalOpen(true); setEditingSupplier(null); setFormData({ name: '', contactPerson: '', phone: '', email: '' }); }}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all"
        >
          <Plus className="w-5 h-5" />
          Add Supplier
        </button>
      </div>

      <div className="route-body desktop-scroll pr-1 custom-scrollbar">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {suppliers.map(sup => (
          <div key={sup.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 group hover:border-indigo-200 transition-all">
            <div className="flex justify-between items-start mb-6">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                <Truck className="w-6 h-6" />
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => { setEditingSupplier(sup); setFormData({ name: sup.name, contactPerson: sup.contactPerson || '', phone: sup.phone || '', email: sup.email || '' }); setIsModalOpen(true); }}
                  className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setSelectedSupplier(sup)}
                  className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                  title="View history"
                >
                  <History className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => handleDelete(sup.id)}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <h3 className="text-lg font-bold text-gray-900">{sup.name}</h3>
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <User className="w-4 h-4" />
                <span>{sup.contactPerson || 'No contact person'}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <Phone className="w-4 h-4" />
                <span>{sup.phone || 'No phone number'}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <Mail className="w-4 h-4" />
                <span>{sup.email || 'No email address'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      </div>

      {/* Supplier History Modal */}
      {selectedSupplier && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 bg-indigo-600 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold text-lg">{selectedSupplier.name}'s History</h3>
                <p className="text-indigo-100 text-xs">Supplier ID: {selectedSupplier.id.slice(0, 8)}</p>
              </div>
              <button onClick={() => setSelectedSupplier(null)} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100">
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Total Orders</p>
                  <p className="text-2xl font-black text-indigo-600">{supplierOrders.length}</p>
                </div>
                <div className="bg-green-50 p-6 rounded-3xl border border-green-100">
                  <p className="text-[10px] font-bold text-green-400 uppercase tracking-widest mb-1">Total Value</p>
                  <p className="text-2xl font-black text-green-600">KES {supplierOrders.reduce((sum, o) => sum + o.totalAmount, 0).toLocaleString()}</p>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Purchase Orders</h4>
                <div className="space-y-3">
                  {supplierOrders.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-3xl border border-dashed border-gray-200 text-gray-400">
                      No purchase orders found for this supplier
                    </div>
                  ) : supplierOrders.map((order) => (
                    <div key={order.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <div className="flex items-center gap-4">
                        <div className={`p-2 rounded-xl ${
                          order.status === 'received' ? 'bg-green-100 text-green-600' : 
                          order.status === 'pending' ? 'bg-amber-100 text-amber-600' : 
                          'bg-red-100 text-red-600'
                        }`}>
                          {order.status === 'received' ? <CheckCircle className="w-4 h-4" /> : 
                           order.status === 'pending' ? <Clock className="w-4 h-4" /> : 
                           <AlertCircle className="w-4 h-4" />}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900">Order #{order.id.slice(-8).toUpperCase()}</p>
                          <p className="text-[10px] text-gray-500 font-medium">{new Date(order.createdAt).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-black text-gray-900">KES {order.totalAmount.toLocaleString()}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          order.status === 'received' ? 'bg-green-100 text-green-600' : 
                          order.status === 'pending' ? 'bg-amber-100 text-amber-600' : 
                          'bg-red-100 text-red-600'
                        }`}>
                          {order.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-4xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95">
            <div className="p-8 border-b border-gray-50">
              <h2 className="text-2xl font-bold text-gray-900">{editingSupplier ? 'Edit Supplier' : 'New Supplier'}</h2>
            </div>
            <form onSubmit={handleSubmit} className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Supplier Name</label>
                <input 
                  required
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                  placeholder="e.g., Coca-Cola Bottlers"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Contact Person</label>
                <input 
                  type="text"
                  value={formData.contactPerson}
                  onChange={e => setFormData({ ...formData, contactPerson: e.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                  placeholder="e.g., Jane Smith"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">Phone</label>
                  <input 
                    type="tel"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full p-4 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                    placeholder="0712345678"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">Email</label>
                  <input 
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                    className="w-full p-4 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                    placeholder="jane@supplier.com"
                  />
                </div>
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
                  {editingSupplier ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
