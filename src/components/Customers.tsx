import React, { useState, useEffect } from 'react';
import { 
  db, 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy,
  where,
  handleFirestoreError,
  OperationType
} from '../data';
import { Customer, Credit } from '../types';
import { useAuth } from '../App';
import { Plus, Search, Edit2, Trash2, Phone, Mail, MapPin, CreditCard, History, X } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from './ConfirmDialog';

export default function Customers() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSales, setCustomerSales] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

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
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    customerCode: ''
  });

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(query(collection(db, 'customers'), orderBy('name', 'asc')), 
      (snapshot) => setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'customers')
    );
    
    const unsubCredits = onSnapshot(query(collection(db, 'credits'), where('status', '==', 'open')),
      (snapshot) => setCredits(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Credit))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'credits')
    );

    return () => {
      unsub();
      unsubCredits();
    };
  }, [user]);

  useEffect(() => {
    const customersWithoutCode = customers.filter(c => !c.customerCode);
    if (customersWithoutCode.length > 0) {
      customersWithoutCode.forEach(async (c) => {
        try {
          const newCode = `C-${Math.floor(1000 + Math.random() * 9000)}`;
          await updateDoc(doc(db, 'customers', c.id), { customerCode: newCode });
        } catch (error) {
          if (process.env.NODE_ENV === 'development') {
            console.error('Error auto-assigning customer code:', error);
          }
        }
      });
    }
  }, [customers]);

  useEffect(() => {
    if (selectedCustomer) {
      const q = query(
        collection(db, 'sales'),
        where('customerId', '==', selectedCustomer.id),
        orderBy('timestamp', 'desc')
      );
      const unsub = onSnapshot(q, (snapshot) => {
        setCustomerSales(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
      return () => unsub();
    }
  }, [selectedCustomer]);

  const getCustomerBalance = (customerId: string) => {
    return credits
      .filter(c => c.customerId === customerId)
      .reduce((sum, c) => sum + c.outstandingBalance, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = {
        name: formData.name,
        phone: formData.phone || '',
        email: formData.email || '',
        address: formData.address || '',
        customerCode: formData.customerCode || `C-${Math.floor(1000 + Math.random() * 9000)}`
      };
      if (editingCustomer) {
        await updateDoc(doc(db, 'customers', editingCustomer.id), data);
        toast.success('Customer profile updated');
      } else {
        await addDoc(collection(db, 'customers'), {
          ...data,
          loyaltyPoints: 0,
          createdAt: new Date().toISOString()
        });
        toast.success('New customer created');
      }
      setIsModalOpen(false);
      resetForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'customers');
      toast.error('Failed to save customer');
    }
  };

  const resetForm = () => {
    setFormData({ name: '', phone: '', email: '', address: '', customerCode: '' });
    setEditingCustomer(null);
  };

  const handleDelete = async (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Customer',
      message: 'Are you sure you want to delete this customer? This action cannot be undone.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'customers', id));
          toast.success('Customer deleted successfully');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'customers');
          toast.error('Failed to delete customer');
        }
      },
      type: 'danger'
    });
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.customerCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone?.includes(searchTerm) ||
    c.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
          <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-500 mt-1">Manage customer profiles and contact information.</p>
        </div>
        <button 
          onClick={() => { resetForm(); setIsModalOpen(true); }}
          className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
        >
          <Plus className="w-5 h-5" />
          Add Customer
        </button>
      </div>

      <div className="route-body">
      <div className="desktop-card bg-white p-8 rounded-4xl shadow-sm border border-gray-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input 
              type="text"
              placeholder="Search by name, phone or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
          </div>
        </div>

        <div className="desktop-table-scroll overflow-x-auto max-h-150 overflow-y-auto pr-2 custom-scrollbar">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-white z-10 shadow-sm">
              <tr className="text-gray-400 text-[10px] uppercase tracking-widest font-bold border-b border-gray-50">
                <th className="px-4 py-4">Code</th>
                <th className="px-4 py-4">Customer</th>
                <th className="px-4 py-4">Contact</th>
                <th className="px-4 py-4">Address</th>
                <th className="px-4 py-4 text-right">Balance</th>
                <th className="px-4 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredCustomers.map(customer => {
                const balance = getCustomerBalance(customer.id);
                return (
                  <tr key={customer.id} className="group hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-6">
                      <span className="text-xs font-mono font-bold bg-gray-100 px-2 py-1 rounded text-gray-600">
                        {customer.customerCode || '---'}
                      </span>
                    </td>
                    <td className="px-4 py-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center font-bold">
                          {customer.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900">{customer.name}</p>
                          <p className="text-[10px] text-gray-500 font-medium">ID: {customer.id.slice(0, 8)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-6">
                      <div className="space-y-1">
                        {customer.phone && (
                          <div className="flex items-center gap-2 text-xs text-gray-600">
                            <Phone className="w-3 h-3" />
                            {customer.phone}
                          </div>
                        )}
                        {customer.email && (
                          <div className="flex items-center gap-2 text-xs text-gray-600">
                            <Mail className="w-3 h-3" />
                            {customer.email}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-6">
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <MapPin className="w-3 h-3" />
                        {customer.address || 'No address provided'}
                      </div>
                    </td>
                    <td className="px-4 py-6 text-right">
                      <div className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${balance > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                        {balance > 0 && <CreditCard className="w-3 h-3" />}
                        KES {balance.toLocaleString()}
                      </div>
                    </td>
                    <td className="px-4 py-6 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => { 
                          setEditingCustomer(customer); 
                          setFormData({
                            name: customer.name,
                            phone: customer.phone || '',
                            email: customer.email || '',
                            address: customer.address || '',
                            customerCode: customer.customerCode || ''
                          }); 
                          setIsModalOpen(true); 
                        }}
                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setSelectedCustomer(customer)}
                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                        title="View history"
                      >
                        <History className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(customer.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-indigo-950/20 backdrop-blur-sm">
          <div className="bg-white rounded-[2.5rem] p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                {editingCustomer ? 'Edit Customer' : 'Add New Customer'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Customer Code</label>
                  <input 
                    type="text"
                    value={formData.customerCode}
                    onChange={e => setFormData({...formData, customerCode: e.target.value})}
                    className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="e.g. C-1234"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Full Name</label>
                  <input 
                    required
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="e.g. John Doe"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Phone Number</label>
                <input 
                  type="tel"
                  value={formData.phone}
                  onChange={e => setFormData({...formData, phone: e.target.value})}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  placeholder="e.g. +254 700 000 000"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Email Address</label>
                <input 
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData({...formData, email: e.target.value})}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  placeholder="e.g. john@example.com"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Physical Address</label>
                <textarea 
                  value={formData.address}
                  onChange={e => setFormData({...formData, address: e.target.value})}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all h-24 resize-none"
                  placeholder="e.g. Nairobi, Kenya"
                />
              </div>

              <button 
                type="submit"
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all"
              >
                {editingCustomer ? 'Update Profile' : 'Create Profile'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Customer History Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 bg-indigo-600 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold text-lg">{selectedCustomer.name}'s Profile</h3>
                <p className="text-indigo-100 text-xs">Customer Code: {selectedCustomer.customerCode}</p>
              </div>
              <button onClick={() => setSelectedCustomer(null)} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100">
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Total Balance</p>
                  <p className="text-2xl font-black text-indigo-600">KES {getCustomerBalance(selectedCustomer.id).toLocaleString()}</p>
                </div>
                <div className="bg-amber-50 p-6 rounded-3xl border border-amber-100">
                  <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-1">Loyalty Points</p>
                  <p className="text-2xl font-black text-amber-600">{selectedCustomer.loyaltyPoints || 0}</p>
                </div>
                <div className="bg-green-50 p-6 rounded-3xl border border-green-100">
                  <p className="text-[10px] font-bold text-green-400 uppercase tracking-widest mb-1">Total Sales</p>
                  <p className="text-2xl font-black text-green-600">{customerSales.length}</p>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Recent Transactions</h4>
                <div className="space-y-3">
                  {customerSales.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-3xl border border-dashed border-gray-200 text-gray-400">
                      No transactions found for this customer
                    </div>
                  ) : customerSales.map((sale) => (
                    <div key={sale.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <div>
                        <p className="text-sm font-bold text-gray-900">Sale #{sale.id.slice(-8).toUpperCase()}</p>
                        <p className="text-[10px] text-gray-500 font-medium">{new Date(sale.timestamp?.toDate()).toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-black text-gray-900">KES {sale.totalAmount.toLocaleString()}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sale.isRefunded ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                          {sale.isRefunded ? 'Refunded' : 'Completed'}
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
    </div>
  );
}
