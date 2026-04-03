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
  getDoc,
  handleFirestoreError,
  OperationType
} from '../data';
import { Product, Category, Supplier, SystemSettings } from '../types';
import { useAuth } from '../App';
import { Search, AlertTriangle } from 'lucide-react';
import JsBarcode from 'jsbarcode';

import { recordAuditLog } from '../services/auditService';
import { toast } from 'sonner';
import ConfirmDialog from './ConfirmDialog';

type ProductFormState = {
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  supplierId: string;
  buyingPrice: number;
  sellingPrice: number;
  stockQuantity: number;
  unitType: string;
  lowStockThreshold: number;
  isHotItem: boolean;
  expiryDate?: string;
};

function createEmptyProductForm(): ProductFormState {
  return {
    name: '',
    sku: '',
    barcode: '',
    categoryId: '',
    supplierId: '',
    buyingPrice: 0,
    sellingPrice: 0,
    stockQuantity: 0,
    unitType: 'pcs',
    lowStockThreshold: 5,
    isHotItem: false,
    expiryDate: ''
  };
}

function mapProductToForm(product: Product): ProductFormState {
  return {
    name: product.name || '',
    sku: product.sku || '',
    barcode: product.barcode || '',
    categoryId: product.categoryId || '',
    supplierId: product.supplierId || '',
    buyingPrice: Number(product.buyingPrice ?? 0),
    sellingPrice: Number(product.sellingPrice ?? 0),
    stockQuantity: Number(product.stockQuantity ?? 0),
    unitType: product.unitType || 'pcs',
    lowStockThreshold: Number(product.lowStockThreshold ?? 5),
    isHotItem: Boolean(product.isHotItem),
    expiryDate: product.expiryDate || ''
  };
}

export default function Products() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [skuPrefix, setSkuPrefix] = useState('KK-');

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
    const fetchSettings = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'system'));
        if (settingsDoc.exists()) {
          setSkuPrefix((settingsDoc.data() as SystemSettings).skuPrefix);
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Error fetching settings:', error);
        }
      }
    };
    fetchSettings();
  }, []);
  
  const [formData, setFormData] = useState<ProductFormState>(createEmptyProductForm);

  useEffect(() => {
    if (!user) return;

    let unsubProducts = () => {};
    let unsubCats = () => {};
    let unsubSups = () => {};

    if (user.role === 'superadmin' || user.permissions.includes('products') || user.permissions.includes('pos') || user.permissions.includes('inventory')) {
      unsubProducts = onSnapshot(query(collection(db, 'products'), orderBy('createdAt', 'desc')), 
        (snapshot) => setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'products')
      );
    }

    if (user.role === 'superadmin' || user.permissions.includes('products') || user.permissions.includes('pos')) {
      unsubCats = onSnapshot(collection(db, 'categories'), 
        (snapshot) => setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'categories')
      );
    }

    if (user.role === 'superadmin' || user.permissions.includes('inventory') || user.permissions.includes('products')) {
      unsubSups = onSnapshot(collection(db, 'suppliers'), 
        (snapshot) => setSuppliers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'suppliers')
      );
    }

    return () => {
      unsubProducts();
      unsubCats();
      unsubSups();
    };
  }, [user]);

  const generateCodes = () => {
    const namePart = formData.name 
      ? formData.name.charAt(0).toUpperCase() + formData.name.slice(1, 3).toLowerCase() 
      : 'Prd';
    const timestamp = Date.now().toString().slice(-4);
    const random = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    const newSku = `${skuPrefix}${namePart}-${timestamp}${random}`.toUpperCase();
    const newBarcode = `2026${Date.now().toString().slice(-8)}`;
    setFormData(prev => ({ ...prev, sku: newSku, barcode: newBarcode }));
  };

  const printLabels = (product: Product) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const canvas = document.createElement('canvas');
    JsBarcode(canvas, product.barcode, { format: "CODE128", width: 2, height: 50 });
    const barcodeDataUrl = canvas.toDataURL("image/png");

    printWindow.document.write(`
      <html>
        <head>
          <title>Print Labels - ${product.name}</title>
          <style>
            body { font-family: sans-serif; display: flex; flex-wrap: wrap; gap: 20px; padding: 20px; }
            .label { border: 1px solid #eee; padding: 15px; width: 200px; text-align: center; border-radius: 8px; }
            .name { font-weight: bold; font-size: 14px; margin-bottom: 5px; }
            .price { font-size: 18px; font-weight: 900; color: #4f46e5; margin-bottom: 10px; }
            img { width: 100%; height: auto; }
            .sku { font-size: 10px; color: #666; margin-top: 5px; }
          </style>
        </head>
        <body>
          ${Array(10).fill(0).map(() => `
            <div class="label">
              <div class="name">${product.name}</div>
              <div class="price">KES ${product.sellingPrice.toLocaleString()}</div>
              <img src="${barcodeDataUrl}" />
              <div class="sku">${product.sku}</div>
            </div>
          `).join('')}
          <script>
            window.onload = () => { window.print(); window.close(); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isSaving) return;

    const normalizedName = formData.name.trim();
    const normalizedSku = formData.sku.trim().toUpperCase();
    const normalizedBarcode = formData.barcode.trim();

    if (!normalizedName || !normalizedSku || !normalizedBarcode) {
      toast.error('Name, SKU, and barcode are required.');
      return;
    }

    const conflictingProduct = products.find((product) =>
      product.id !== editingProduct?.id &&
      (
        product.sku.trim().toUpperCase() === normalizedSku ||
        product.barcode.trim() === normalizedBarcode
      )
    );

    if (conflictingProduct) {
      toast.error(
        conflictingProduct.sku.trim().toUpperCase() === normalizedSku
          ? `SKU ${normalizedSku} already exists.`
          : `Barcode ${normalizedBarcode} already exists.`
      );
      return;
    }

    setIsSaving(true);
    try {
      const data = {
        ...formData,
        name: normalizedName,
        sku: normalizedSku,
        barcode: normalizedBarcode,
        updatedAt: new Date().toISOString()
      };

      if (editingProduct) {
        await updateDoc(doc(db, 'products', editingProduct.id), data);
        setProducts(prev =>
          prev.map(product =>
            product.id === editingProduct.id
              ? {
                  ...product,
                  ...data,
                  categoryId: data.categoryId || '',
                  supplierId: data.supplierId || '',
                  expiryDate: data.expiryDate || undefined,
                  updatedAt: data.updatedAt
                }
              : product
          )
        );
        await recordAuditLog(user.uid, user.displayName || user.username, 'UPDATE_PRODUCT', `Updated product: ${data.name} (SKU: ${data.sku})`);
        toast.success('Product updated successfully');
      } else {
        await addDoc(collection(db, 'products'), {
          ...data,
          createdAt: new Date().toISOString()
        });
        await recordAuditLog(user.uid, user.displayName || user.username, 'CREATE_PRODUCT', `Created new product: ${data.name} (SKU: ${data.sku})`);
        toast.success('Product created successfully');
      }
      resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save product';
      if (process.env.NODE_ENV === 'development') {
        try {
          handleFirestoreError(error, OperationType.WRITE, 'products');
        } catch {
          // The product form already surfaces the user-facing error below.
        }
      }
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setFormData(createEmptyProductForm());
    setEditingProduct(null);
  };

  const handleDelete = async (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Product',
      message: 'Are you sure you want to delete this product? This action cannot be undone.',
      onConfirm: async () => {
        try {
          const product = products.find(p => p.id === id);
          await deleteDoc(doc(db, 'products', id));
          await recordAuditLog(user!.uid, user!.displayName || user!.username, 'DELETE_PRODUCT', `Deleted product: ${product?.name} (SKU: ${product?.sku})`);
          toast.success('Product deleted successfully');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'products');
          toast.error('Failed to delete product');
        }
      },
      type: 'danger'
    });
  };

  const generateBarcode = (code: string) => {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, code, { format: "CODE128", width: 2, height: 50 });
    const link = document.createElement('a');
    link.href = canvas.toDataURL("image/png");
    link.download = `barcode-${code}.png`;
    link.click();
  };

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Products</h1>
        <p className="text-gray-500 mt-1">Manage catalog records, prices, stock units, and barcode identifiers.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        {/* Add Product Form */}
        <div className="xl:col-span-5 bg-white p-8 rounded-4xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-8">
            <h2 className="text-2xl font-bold text-gray-900">
              {editingProduct ? 'Edit Product' : 'Add Product'}
            </h2>
            <button 
              type="button"
              onClick={generateCodes}
              className="bg-indigo-600 text-white px-4 py-3 rounded-xl text-sm font-bold leading-tight hover:bg-indigo-700 transition-colors w-24 text-center"
            >
              Auto Generate Codes
            </button>
          </div>

          <p className="text-sm text-gray-500 mb-8 leading-relaxed">
            Use existing manufacturer barcode when available. Generate only if product has no barcode.
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Name</label>
                <input 
                  required
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">SKU</label>
                <input 
                  required
                  type="text"
                  value={formData.sku}
                  onChange={e => setFormData({...formData, sku: e.target.value.toUpperCase()})}
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Barcode</label>
                <input 
                  required
                  type="text"
                  value={formData.barcode}
                  onChange={e => setFormData({...formData, barcode: e.target.value})}
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Barcode Format</label>
                <select className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none">
                  <option>EAN-13</option>
                  <option>CODE128</option>
                  <option>UPC-A</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Category</label>
                <select 
                  value={formData.categoryId}
                  onChange={e => setFormData({...formData, categoryId: e.target.value})}
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                >
                  <option value="">Select Category</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Supplier</label>
                <select 
                  value={formData.supplierId}
                  onChange={e => setFormData({...formData, supplierId: e.target.value})}
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                >
                  <option value="">Select Supplier</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Buying Price</label>
                <input 
                  required
                  type="number"
                  value={formData.buyingPrice}
                  onChange={e => setFormData({...formData, buyingPrice: Number(e.target.value)})}
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Selling Price</label>
                <input 
                  required
                  type="number"
                  value={formData.sellingPrice}
                  onChange={e => setFormData({...formData, sellingPrice: Number(e.target.value)})}
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Stock Qty</label>
                <input 
                  required
                  type="number"
                  value={formData.stockQuantity}
                  onChange={e => setFormData({...formData, stockQuantity: Number(e.target.value)})}
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Low Stock Alert At</label>
                <input 
                  required
                  type="number"
                  value={formData.lowStockThreshold}
                  onChange={e => setFormData({...formData, lowStockThreshold: Number(e.target.value)})}
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Unit</label>
                <input 
                  type="text"
                  value={formData.unitType}
                  onChange={e => setFormData({...formData, unitType: e.target.value})}
                  placeholder="pcs, kg, ltr..."
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input 
                  type="checkbox"
                  id="isHotItem"
                  checked={formData.isHotItem}
                  onChange={e => setFormData({...formData, isHotItem: e.target.checked})}
                  className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
                />
                <label htmlFor="isHotItem" className="text-sm font-bold text-gray-700">Quick-Add Item (Sale)</label>
              </div>
            </div>

            <div className="pt-4 flex gap-4">
              <button 
                type="submit"
                disabled={isSaving}
                className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
              >
                {isSaving ? 'Saving...' : editingProduct ? 'Update Product' : 'Save Product'}
              </button>
              {editingProduct && (
                <button 
                  type="button"
                  disabled={isSaving}
                  onClick={resetForm}
                  className="px-8 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Product List */}
        <div className="xl:col-span-7 bg-white p-8 rounded-4xl shadow-sm border border-gray-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Product List</h2>
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
              <input 
                type="text"
                placeholder="Search name, SKU, barcod"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
              />
            </div>
          </div>

          <div className="overflow-x-auto max-h-150 overflow-y-auto pr-2 custom-scrollbar">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-white z-10 shadow-sm text-gray-500 text-[10px] uppercase tracking-widest font-bold">
                <tr className="bg-gray-50/50">
                  <th className="px-4 py-4">Name</th>
                  <th className="px-4 py-4">SKU</th>
                  <th className="px-4 py-4">Barcode</th>
                  <th className="px-4 py-4">Stock</th>
                  <th className="px-4 py-4">Price</th>
                  <th className="px-4 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredProducts.map(product => (
                  <tr key={product.id} className="group hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-6">
                      <p className="text-sm font-medium text-gray-900">{product.name}</p>
                    </td>
                    <td className="px-4 py-6">
                      <p className="text-xs font-medium text-gray-500">{product.sku}</p>
                    </td>
                    <td className="px-4 py-6">
                      <p className="text-xs font-medium text-gray-500">{product.barcode}</p>
                    </td>
                    <td className="px-4 py-6">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-bold ${product.stockQuantity <= (product.lowStockThreshold || 5) ? 'text-red-600' : 'text-gray-900'}`}>
                          {product.stockQuantity}
                        </p>
                        {product.stockQuantity <= (product.lowStockThreshold || 5) && (
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                        )}
                      </div>
                      <p className="text-[10px] text-gray-600 uppercase font-bold">{product.unitType}</p>
                    </td>
                    <td className="px-4 py-6">
                      <p className="text-sm font-bold text-gray-900">{product.sellingPrice.toFixed(2)}</p>
                    </td>
                    <td className="px-4 py-6">
                      <div className="flex flex-col gap-1 w-20">
                        <button 
                          onClick={() => {
                            setEditingProduct(product);
                            setFormData(mapProductToForm(product));
                          }}
                          className="px-3 py-1.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded-lg hover:bg-indigo-100 transition-colors"
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => generateBarcode(product.barcode)}
                          className="px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                          Barcode
                        </button>
                        <button 
                          onClick={() => printLabels(product)}
                          className="px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                          Labels
                        </button>
                        <button 
                          onClick={() => handleDelete(product.id)}
                          className="px-3 py-1.5 bg-red-600 text-white text-[10px] font-bold rounded-lg hover:bg-red-700 transition-colors"
                        >
                          Archive
                        </button>
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
  );
}
