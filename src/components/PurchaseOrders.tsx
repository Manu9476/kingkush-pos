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
  orderBy,
  handleFirestoreError,
  OperationType,
  toDate
} from '../data';
import { PurchaseOrder, Product, Supplier, Category, Branch } from '../types';
import { useAuth } from '../App';
import { 
  Plus, 
  Search, 
  Truck, 
  CheckCircle, 
  X, 
  ChevronRight,
  AlertCircle,
  Edit2,
  Trash2
} from 'lucide-react';
import { recordAuditLog } from '../services/auditService';
import { toast } from 'sonner';
import ConfirmDialog from './ConfirmDialog';
import { receivePurchaseOrder } from '../services/platformApi';

export default function PurchaseOrders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNewProductModalOpen, setIsNewProductModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
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
    supplierId: '',
    items: [] as { productId: string; productName: string; quantity: number; costPrice: number }[],
    notes: ''
  });

  const [itemToAdd, setItemToAdd] = useState<{
    productId: string;
    productName: string;
    quantity: number;
    costPrice: number;
  } | null>(null);

  const [newProductData, setNewProductData] = useState({
    name: '',
    sku: '',
    barcode: '',
    categoryId: '',
    buyingPrice: 0,
    sellingPrice: 0,
    unitType: 'pcs',
    initialOrderQuantity: 1
  });

  useEffect(() => {
    const unsubOrders = onSnapshot(query(collection(db, 'purchase_orders'), orderBy('createdAt', 'desc')), 
      (snapshot) => setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseOrder))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'purchase_orders')
    );
    const unsubProducts = onSnapshot(collection(db, 'products'), 
      (snapshot) => setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'products')
    );
    const unsubSuppliers = onSnapshot(collection(db, 'suppliers'), 
      (snapshot) => setSuppliers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'suppliers')
    );
    const unsubCategories = onSnapshot(collection(db, 'categories'), 
      (snapshot) => setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'categories')
    );
    const unsubBranches = onSnapshot(collection(db, 'branches'),
      (snapshot) => setBranches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Branch))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'branches')
    );
    return () => {
      unsubOrders();
      unsubProducts();
      unsubSuppliers();
      unsubCategories();
      unsubBranches();
    };
  }, []);

  const handleAddItem = (productId: string, quantity: number = 1, costPrice?: number) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    if (formData.items.find(item => item.productId === productId)) return;

    setFormData({
      ...formData,
      items: [...formData.items, { 
        productId, 
        productName: product.name, 
        quantity, 
        costPrice: costPrice ?? product.buyingPrice 
      }]
    });
    setItemToAdd(null);
  };

  const handleRemoveItem = (index: number) => {
    const newItems = [...formData.items];
    newItems.splice(index, 1);
    setFormData({ ...formData, items: newItems });
  };

  const handleUpdateItem = (index: number, field: 'quantity' | 'costPrice', value: number) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormData({ ...formData, items: newItems });
  };

  const handleEditOrder = (order: PurchaseOrder) => {
    setFormData({
      supplierId: order.supplierId,
      items: order.items,
      notes: order.notes || ''
    });
    setIsEditing(true);
    setIsModalOpen(true);
  };

  const handleDeleteOrder = async (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Purchase Order',
      message: 'Are you sure you want to PERMANENTLY delete this purchase order? This action cannot be undone.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'purchase_orders', id));
          await recordAuditLog(user!.uid, user!.displayName || user!.username, 'DELETE_PO', `Deleted Purchase Order ${id}`);
          setSelectedOrder(null);
          toast.success('Purchase order deleted successfully');
        } catch (error) {
          console.error('Error deleting PO:', error);
          handleFirestoreError(error, OperationType.DELETE, 'purchase_orders');
          toast.error('Failed to delete purchase order');
        }
      },
      type: 'danger'
    });
  };

  const handleCancelOrder = async (orderId: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Cancel Purchase Order',
      message: 'Are you sure you want to cancel this purchase order?',
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, 'purchase_orders', orderId), {
            status: 'cancelled'
          });
          await recordAuditLog(user!.uid, user!.displayName || user!.username, 'CANCEL_PO', `Cancelled Purchase Order ${orderId}`);
          setSelectedOrder(null);
          toast.success('Purchase order cancelled');
        } catch (error) {
          console.error('Error cancelling PO:', error);
          toast.error('Failed to cancel purchase order');
        }
      },
      type: 'warning'
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.supplierId || formData.items.length === 0) return;

    try {
      const totalAmount = formData.items.reduce((sum, item) => sum + (item.quantity * item.costPrice), 0);
      const supplier = suppliers.find(s => s.id === formData.supplierId);
      const branch = branches.find((entry) => entry.id === (user?.branchId || 'branch_main'));

      const orderData = {
        supplierId: formData.supplierId,
        supplierName: supplier?.name || 'Unknown',
        branchId: branch?.id || user?.branchId || 'branch_main',
        branchName: branch?.name || 'Main Branch',
        items: formData.items,
        totalAmount,
        status: 'pending',
        notes: formData.notes,
        updatedAt: new Date().toISOString()
      };

      if (isEditing && selectedOrder) {
        await updateDoc(doc(db, 'purchase_orders', selectedOrder.id), orderData);
        await recordAuditLog(user!.uid, user!.displayName || user!.username, 'UPDATE_PO', `Updated Purchase Order for ${supplier?.name}`);
      } else {
        const newOrderData = {
          ...orderData,
          createdAt: new Date().toISOString(),
          createdBy: user?.displayName || user?.username
        };
        await addDoc(collection(db, 'purchase_orders'), newOrderData);
        await recordAuditLog(user!.uid, user!.displayName || user!.username, 'CREATE_PO', `Created Purchase Order for ${supplier?.name}`);
      }
      
      setIsModalOpen(false);
      setIsEditing(false);
      setSelectedOrder(null);
      setFormData({ supplierId: '', items: [], notes: '' });
    } catch (error) {
      console.error('Error saving PO:', error);
    }
  };

  const handleCreateNewProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const productData = {
        name: newProductData.name,
        sku: newProductData.sku,
        barcode: newProductData.barcode,
        categoryId: newProductData.categoryId,
        buyingPrice: newProductData.buyingPrice,
        sellingPrice: newProductData.sellingPrice,
        unitType: newProductData.unitType,
        supplierId: formData.supplierId,
        stockQuantity: 0,
        lowStockThreshold: 5,
        isHotItem: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const docRef = await addDoc(collection(db, 'products'), productData);
      await recordAuditLog(user!.uid, user!.displayName || user!.username, 'CREATE_PRODUCT_PO', `Created product ${newProductData.name} during PO creation`);
      
      // Add the new product to the PO items with specified quantity and cost
      handleAddItem(docRef.id, newProductData.initialOrderQuantity, newProductData.buyingPrice);
      
      setIsNewProductModalOpen(false);
      setNewProductData({
        name: '',
        sku: '',
        barcode: '',
        categoryId: '',
        buyingPrice: 0,
        sellingPrice: 0,
        unitType: 'pcs',
        initialOrderQuantity: 1
      });
    } catch (error) {
      console.error('Error creating product:', error);
    }
  };

  const handleReceiveOrder = async (order: PurchaseOrder) => {
    if (order.status !== 'pending') return;
    
    setConfirmConfig({
      isOpen: true,
      title: 'Receive Purchase Order',
      message: 'Mark this order as received? This will update inventory levels and cost prices.',
      onConfirm: async () => {
        try {
          await receivePurchaseOrder(order.id);
          setSelectedOrder(null);
          toast.success('Purchase order received and inventory updated');
        } catch (error) {
          console.error('Error receiving PO:', error);
          toast.error('Failed to receive purchase order');
        }
      },
      type: 'info'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-amber-100 text-amber-600';
      case 'received': return 'bg-green-100 text-green-600';
      case 'cancelled': return 'bg-red-100 text-red-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div className="route-workspace space-y-6">
      <ConfirmDialog
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
        type={confirmConfig.type}
      />
      <div className="route-header flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Purchase Orders</h1>
          <p className="text-gray-500 font-medium">Manage stock procurement and supplier deliveries</p>
        </div>
        <button 
          onClick={() => {
            setIsEditing(false);
            setFormData({ supplierId: '', items: [], notes: '' });
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
        >
          <Plus className="w-5 h-5" />
          New Purchase Order
        </button>
      </div>

      <div className="route-body desktop-scroll pr-1 custom-scrollbar">
        <div className="desktop-card bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input 
              type="text"
              placeholder="Search by supplier or status..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
          </div>
        </div>

        <div className="desktop-table-scroll overflow-x-auto max-h-150 overflow-y-auto pr-2 custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-white z-10 shadow-sm">
              <tr className="bg-gray-50/50">
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Order ID</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Date</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Supplier</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Total Amount</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">No purchase orders found</td>
                </tr>
              ) : orders.filter(o => o.supplierName.toLowerCase().includes(searchTerm.toLowerCase()) || o.status.includes(searchTerm.toLowerCase())).map((order) => (
                <tr key={order.id} className="hover:bg-gray-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs font-bold text-indigo-600">#{order.id.slice(-8).toUpperCase()}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-gray-900">{new Date(order.createdAt).toLocaleDateString()}</div>
                    <div className="text-[10px] text-gray-400 font-medium">{order.createdBy}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                        <Truck className="w-4 h-4" />
                      </div>
                      <span className="text-sm font-bold text-gray-900">{order.supplierName}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-black text-gray-900">KES {order.totalAmount.toLocaleString()}</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusColor(order.status)}`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => setSelectedOrder(order)}
                      className="p-2 hover:bg-indigo-50 text-indigo-600 rounded-xl transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      </div>

      {/* New PO Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 bg-indigo-600 text-white flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg">{isEditing ? 'Edit Purchase Order' : 'Create New Purchase Order'}</h3>
              <button onClick={() => {
                setIsModalOpen(false);
                setIsEditing(false);
                setFormData({ supplierId: '', items: [], notes: '' });
              }} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-8 space-y-8">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Supplier</label>
                  <select 
                    required
                    value={formData.supplierId}
                    onChange={(e) => setFormData({ ...formData, supplierId: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="">Select Supplier</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Add Product</label>
                  <div className="flex gap-2">
                    <select 
                      onChange={(e) => {
                        const product = products.find(p => p.id === e.target.value);
                        if (product) {
                          setItemToAdd({
                            productId: product.id,
                            productName: product.name,
                            quantity: 1,
                            costPrice: product.buyingPrice
                          });
                        }
                      }}
                      className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                      value={itemToAdd?.productId || ""}
                    >
                      <option value="">Search & Select Product...</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>{p.name} (SKU: {p.sku})</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setIsNewProductModalOpen(true)}
                      className="p-3 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-colors"
                      title="Create New Product"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>

                  {itemToAdd && (
                    <div className="mt-4 p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="flex justify-between items-center mb-3">
                        <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest">Add {itemToAdd.productName}</p>
                        <button onClick={() => setItemToAdd(null)} className="text-gray-400 hover:text-gray-600">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-500 uppercase">Quantity</label>
                          <input 
                            type="number"
                            value={itemToAdd.quantity}
                            onChange={(e) => setItemToAdd({ ...itemToAdd, quantity: parseFloat(e.target.value) || 0 })}
                            className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold"
                            min="1"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-500 uppercase">Cost Price</label>
                          <input 
                            type="number"
                            value={itemToAdd.costPrice}
                            onChange={(e) => setItemToAdd({ ...itemToAdd, costPrice: parseFloat(e.target.value) || 0 })}
                            className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold"
                          />
                        </div>
                      </div>
                      <button 
                        type="button"
                        onClick={() => handleAddItem(itemToAdd.productId, itemToAdd.quantity, itemToAdd.costPrice)}
                        className="w-full mt-3 py-2 bg-indigo-600 text-white rounded-xl font-bold text-xs hover:bg-indigo-700 transition-all"
                      >
                        Add to Order
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Order Items</h4>
                <div className="space-y-3">
                  {formData.items.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-400 text-sm">
                      No items added yet
                    </div>
                  ) : formData.items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-4 items-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <div className="col-span-5">
                        <p className="text-sm font-bold text-gray-900">{item.productName}</p>
                      </div>
                      <div className="col-span-3">
                        <input 
                          type="number"
                          value={item.quantity}
                          onChange={(e) => handleUpdateItem(idx, 'quantity', parseFloat(e.target.value))}
                          className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold"
                          placeholder="Qty"
                        />
                      </div>
                      <div className="col-span-3">
                        <input 
                          type="number"
                          value={item.costPrice}
                          onChange={(e) => handleUpdateItem(idx, 'costPrice', parseFloat(e.target.value))}
                          className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm font-bold"
                          placeholder="Cost"
                        />
                      </div>
                      <div className="col-span-1 text-right">
                        <button 
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="text-red-400 hover:text-red-600 transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Notes (optional)</label>
                <textarea 
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none min-h-25"
                  placeholder="Additional instructions for the supplier..."
                />
              </div>

              <div className="flex justify-between items-center pt-6 border-t border-gray-100">
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Total Order Value</p>
                  <p className="text-2xl font-black text-gray-900">
                    KES {formData.items.reduce((sum, item) => sum + (item.quantity * item.costPrice), 0).toLocaleString()}
                  </p>
                </div>
                <button 
                  type="submit"
                  disabled={formData.items.length === 0 || !formData.supplierId}
                  className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:bg-gray-400"
                >
                  {isEditing ? 'Save Changes' : 'Create Purchase Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PO Details Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 bg-indigo-600 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold text-lg">Purchase Order Details</h3>
                <p className="text-indigo-100 text-xs">#{selectedOrder.id.toUpperCase()}</p>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Supplier</p>
                  <p className="text-sm font-bold text-gray-900">{selectedOrder.supplierName}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Status</p>
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusColor(selectedOrder.status)}`}>
                    {selectedOrder.status}
                  </span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Order Items</h4>
                <div className="space-y-3">
                  {selectedOrder.items.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{item.productName}</p>
                        <p className="text-[10px] text-gray-500 font-medium">KES {item.costPrice.toLocaleString()} x {item.quantity}</p>
                      </div>
                      <p className="text-sm font-black text-gray-900">KES {(item.costPrice * item.quantity).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </div>

              {selectedOrder.notes && (
                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Notes</h4>
                  <p className="text-sm text-gray-600 bg-gray-50 p-4 rounded-2xl border border-gray-100 italic">
                    "{selectedOrder.notes}"
                  </p>
                </div>
              )}

              <div className="border-t border-gray-100 pt-6 flex flex-wrap gap-4 justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Total Amount</p>
                  <p className="text-2xl font-black text-gray-900">KES {selectedOrder.totalAmount.toLocaleString()}</p>
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={() => handleDeleteOrder(selectedOrder.id)}
                    className="flex items-center gap-2 px-6 py-3 border border-red-200 text-red-600 rounded-2xl font-bold hover:bg-red-50 transition-all"
                    title="Delete permanently"
                  >
                    <Trash2 className="w-5 h-5" />
                    Delete
                  </button>
                  {selectedOrder.status === 'pending' && (
                    <>
                      <button 
                        onClick={() => handleCancelOrder(selectedOrder.id)}
                        className="flex items-center gap-2 px-6 py-3 border border-red-200 text-red-600 rounded-2xl font-bold hover:bg-red-50 transition-all"
                      >
                        <AlertCircle className="w-5 h-5" />
                        Cancel Order
                      </button>
                      <button 
                        onClick={() => handleEditOrder(selectedOrder)}
                        className="flex items-center gap-2 px-6 py-3 border border-indigo-200 text-indigo-600 rounded-2xl font-bold hover:bg-indigo-50 transition-all"
                      >
                        <Edit2 className="w-5 h-5" />
                        Edit Order
                      </button>
                      <button 
                        onClick={() => handleReceiveOrder(selectedOrder)}
                        className="flex items-center gap-2 px-8 py-4 bg-green-600 text-white rounded-2xl font-bold hover:bg-green-700 transition-all shadow-lg shadow-green-100"
                      >
                        <CheckCircle className="w-5 h-5" />
                        Mark as Received
                      </button>
                    </>
                  )}
                </div>
              </div>

              {selectedOrder.status === 'received' && (
                <div className="bg-green-50 p-6 rounded-3xl border border-green-100 space-y-2">
                  <div className="flex items-center gap-3 text-green-600">
                    <CheckCircle className="w-6 h-6" />
                    <h4 className="font-bold">Order Received</h4>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="text-green-400 font-bold uppercase tracking-widest mb-1">Received At</p>
                      <p className="text-green-900 font-bold">{toDate(selectedOrder.receivedAt!).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-green-400 font-bold uppercase tracking-widest mb-1">Received By</p>
                      <p className="text-green-900 font-bold">{selectedOrder.receivedBy}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* New Product Modal */}
      {isNewProductModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-60 p-4">
          <div className="bg-white rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 bg-indigo-600 text-white flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg">Create New Product</h3>
              <button onClick={() => setIsNewProductModalOpen(false)} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleCreateNewProduct} className="flex-1 overflow-y-auto p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Product Name</label>
                <input 
                  required
                  type="text"
                  value={newProductData.name}
                  onChange={(e) => setNewProductData({ ...newProductData, name: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="e.g. Fresh Milk 500ml"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">SKU</label>
                  <input 
                    required
                    type="text"
                    value={newProductData.sku}
                    onChange={(e) => setNewProductData({ ...newProductData, sku: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="e.g. MILK-001"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Barcode</label>
                  <input 
                    required
                    type="text"
                    value={newProductData.barcode}
                    onChange={(e) => setNewProductData({ ...newProductData, barcode: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="e.g. 616123456789"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Category</label>
                  <select 
                    required
                    value={newProductData.categoryId}
                    onChange={(e) => setNewProductData({ ...newProductData, categoryId: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="">Select Category</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Unit Type</label>
                  <select 
                    value={newProductData.unitType}
                    onChange={(e) => setNewProductData({ ...newProductData, unitType: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="pcs">Pieces (pcs)</option>
                    <option value="kg">Kilograms (kg)</option>
                    <option value="ltr">Liters (ltr)</option>
                    <option value="box">Box</option>
                    <option value="pkt">Packet</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Buying Price</label>
                  <input 
                    type="number"
                    value={newProductData.buyingPrice}
                    onChange={(e) => setNewProductData({ ...newProductData, buyingPrice: parseFloat(e.target.value) })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Selling Price</label>
                  <input 
                    required
                    type="number"
                    value={newProductData.sellingPrice}
                    onChange={(e) => setNewProductData({ ...newProductData, sellingPrice: parseFloat(e.target.value) })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Qty to Order</label>
                  <input 
                    required
                    type="number"
                    value={newProductData.initialOrderQuantity}
                    onChange={(e) => setNewProductData({ ...newProductData, initialOrderQuantity: parseFloat(e.target.value) })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    min="1"
                  />
                </div>
              </div>

              <div className="pt-6 border-t border-gray-100">
                <button 
                  type="submit"
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                >
                  Create Product & Add to Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
