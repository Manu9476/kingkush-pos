import { useState, useEffect } from 'react';
import { 
  db, 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  limit,
  handleFirestoreError,
  OperationType
} from '../data';
import { Product, InventoryTransaction, Supplier } from '../types';
import { 
  ClipboardList, 
  ArrowUpRight, 
  ArrowDownRight, 
  Search, 
  AlertTriangle, 
  Truck, 
  PackagePlus, 
  Settings, 
  ScanLine,
  CheckCircle2
} from 'lucide-react';
import { useAuth } from '../App';
import { processInventoryMovement } from '../services/platformApi';

export default function Inventory() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isScannerOn, setIsScannerOn] = useState(false);
  const [activeAction, setActiveAction] = useState<'receiving' | 'stock-in' | 'adjustment'>('receiving');

  // Supplier Receiving State
  const [receiving, setReceiving] = useState({
    productId: '',
    barcode: '',
    supplierId: '',
    quantity: 0,
    unitCost: 0,
    reference: '',
    notes: 'Supplier stock received'
  });

  // Stock In State
  const [stockIn, setStockIn] = useState({
    productId: '',
    barcode: '',
    quantity: 0,
    reason: 'New stock arrived'
  });

  // Adjustment State
  const [adjustment, setAdjustment] = useState({
    productId: '',
    barcode: '',
    quantity: 0,
    type: 'Adjustment',
    reason: 'Manual adjustment'
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (!user) return;
    const unsubProducts = onSnapshot(collection(db, 'products'), 
      (snapshot) => setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'products')
    );
    const unsubSuppliers = onSnapshot(collection(db, 'suppliers'), 
      (snapshot) => setSuppliers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'suppliers')
    );
    const unsubTrans = onSnapshot(query(collection(db, 'inventory_transactions'), orderBy('timestamp', 'desc'), limit(50)), 
      (snapshot) => setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryTransaction))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'inventory_transactions')
    );

    return () => {
      unsubProducts();
      unsubSuppliers();
      unsubTrans();
    };
  }, [user]);

  const handleBarcodeScan = async (barcode: string, actionType: 'receiving' | 'stock-in' | 'adjustment') => {
    const product = products.find(p => p.barcode === barcode || p.sku.toUpperCase() === barcode.toUpperCase());
    if (product) {
      if (actionType === 'receiving') setReceiving(prev => ({ ...prev, productId: product.id, barcode: product.barcode }));
      if (actionType === 'stock-in') setStockIn(prev => ({ ...prev, productId: product.id, barcode: product.barcode }));
      if (actionType === 'adjustment') setAdjustment(prev => ({ ...prev, productId: product.id, barcode: product.barcode }));
    }
  };

  const handleReceiveStock = async () => {
    if (!receiving.productId && !receiving.barcode) return;
    setIsProcessing(true);
    try {
      await processInventoryMovement({
        actionType: 'receiving',
        productId: receiving.productId || undefined,
        barcode: receiving.barcode || undefined,
        quantity: receiving.quantity,
        supplierId: receiving.supplierId || undefined,
        unitCost: receiving.unitCost || undefined,
        reference: receiving.reference || undefined,
        reason: receiving.reference ? `Supplier Receive: ${receiving.reference}` : receiving.notes,
        notes: receiving.notes
      });
      setSuccessMessage('Stock received successfully!');
      setReceiving({ productId: '', barcode: '', supplierId: '', quantity: 0, unitCost: 0, reference: '', notes: 'Supplier stock received' });
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'inventory_transactions');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyStockIn = async () => {
    if (!stockIn.productId && !stockIn.barcode) return;
    setIsProcessing(true);
    try {
      await processInventoryMovement({
        actionType: 'stock-in',
        productId: stockIn.productId || undefined,
        barcode: stockIn.barcode || undefined,
        quantity: stockIn.quantity,
        reason: stockIn.reason
      });
      setSuccessMessage('Stock in applied successfully!');
      setStockIn({ productId: '', barcode: '', quantity: 0, reason: 'New stock arrived' });
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'inventory_transactions');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyAdjustment = async () => {
    if (!adjustment.productId && !adjustment.barcode) return;
    setIsProcessing(true);
    try {
      await processInventoryMovement({
        actionType: 'adjustment',
        productId: adjustment.productId || undefined,
        barcode: adjustment.barcode || undefined,
        quantity: adjustment.quantity,
        reason: adjustment.reason
      });
      setSuccessMessage('Adjustment applied successfully!');
      setAdjustment({ productId: '', barcode: '', quantity: 0, type: 'Adjustment', reason: 'Manual adjustment' });
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'inventory_transactions');
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.sku.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Inventory Tracking</h1>
          <p className="text-gray-500">Monitor stock levels and movement history.</p>
        </div>
        {successMessage && (
          <div className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-600 rounded-xl font-bold text-sm animate-bounce">
            <CheckCircle2 className="w-4 h-4" />
            {successMessage}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Stock Actions */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Stock Actions</h2>
              <button 
                onClick={() => setIsScannerOn(!isScannerOn)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${isScannerOn ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-gray-100 text-gray-500'}`}
              >
                <ScanLine className="w-4 h-4" />
                {isScannerOn ? 'Scanner ON' : 'Scanner OFF'}
              </button>
            </div>

            <div className="flex p-1 bg-gray-50 rounded-2xl">
              <button 
                onClick={() => setActiveAction('receiving')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${activeAction === 'receiving' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Receiving
              </button>
              <button 
                onClick={() => setActiveAction('stock-in')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${activeAction === 'stock-in' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Stock In
              </button>
              <button 
                onClick={() => setActiveAction('adjustment')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${activeAction === 'adjustment' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Adjustment
              </button>
            </div>

            {activeAction === 'receiving' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <Truck className="w-5 h-5 text-indigo-600" />
                  Supplier Receiving
                </h3>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Product ID (optional)</label>
                    <input 
                      type="text" 
                      value={receiving.productId}
                      onChange={e => setReceiving(prev => ({ ...prev, productId: e.target.value }))}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Or Product Barcode</label>
                    <input 
                      type="text" 
                      placeholder="Scan existing product barcode"
                      value={receiving.barcode}
                      onChange={e => {
                        setReceiving(prev => ({ ...prev, barcode: e.target.value }));
                        handleBarcodeScan(e.target.value, 'receiving');
                      }}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Supplier ID</label>
                    <select 
                      value={receiving.supplierId}
                      onChange={e => setReceiving(prev => ({ ...prev, supplierId: e.target.value }))}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    >
                      <option value="">Select Supplier</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Quantity</label>
                      <input 
                        type="number" 
                        value={receiving.quantity || ''}
                        onChange={e => setReceiving(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Unit Cost</label>
                      <input 
                        type="number" 
                        value={receiving.unitCost || ''}
                        onChange={e => setReceiving(prev => ({ ...prev, unitCost: Number(e.target.value) }))}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Reference No</label>
                    <input 
                      type="text" 
                      value={receiving.reference}
                      onChange={e => setReceiving(prev => ({ ...prev, reference: e.target.value }))}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Notes</label>
                    <textarea 
                      value={receiving.notes}
                      onChange={e => setReceiving(prev => ({ ...prev, notes: e.target.value }))}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600 h-20 resize-none"
                    />
                  </div>
                  <button 
                    onClick={handleReceiveStock}
                    disabled={isProcessing}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:bg-gray-300"
                  >
                    Receive Stock
                  </button>
                </div>
              </div>
            )}

            {activeAction === 'stock-in' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <PackagePlus className="w-5 h-5 text-indigo-600" />
                  Stock In
                </h3>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Product ID (optional)</label>
                    <input 
                      type="text" 
                      value={stockIn.productId}
                      onChange={e => setStockIn(prev => ({ ...prev, productId: e.target.value }))}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Or Product Barcode</label>
                    <input 
                      type="text" 
                      placeholder="Scan existing product barcode"
                      value={stockIn.barcode}
                      onChange={e => {
                        setStockIn(prev => ({ ...prev, barcode: e.target.value }));
                        handleBarcodeScan(e.target.value, 'stock-in');
                      }}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Quantity</label>
                    <input 
                      type="number" 
                      value={stockIn.quantity || ''}
                      onChange={e => setStockIn(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Reason</label>
                    <input 
                      type="text" 
                      value={stockIn.reason}
                      onChange={e => setStockIn(prev => ({ ...prev, reason: e.target.value }))}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <button 
                    onClick={handleApplyStockIn}
                    disabled={isProcessing}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:bg-gray-300"
                  >
                    Apply Stock In
                  </button>
                </div>
              </div>
            )}

            {activeAction === 'adjustment' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-indigo-600" />
                  Adjustment
                </h3>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Product ID (optional)</label>
                    <input 
                      type="text" 
                      value={adjustment.productId}
                      onChange={e => setAdjustment(prev => ({ ...prev, productId: e.target.value }))}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Or Product Barcode</label>
                    <input 
                      type="text" 
                      placeholder="Scan existing product barcode"
                      value={adjustment.barcode}
                      onChange={e => {
                        setAdjustment(prev => ({ ...prev, barcode: e.target.value }));
                        handleBarcodeScan(e.target.value, 'adjustment');
                      }}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Change (+ or -)</label>
                    <input 
                      type="number" 
                      value={adjustment.quantity || ''}
                      onChange={e => setAdjustment(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Type</label>
                    <input 
                      type="text" 
                      readOnly
                      value={adjustment.type}
                      className="w-full p-3 bg-gray-100 border border-gray-200 rounded-xl text-sm outline-none text-gray-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Reason</label>
                    <select 
                      value={adjustment.reason}
                      onChange={e => setAdjustment(prev => ({ ...prev, reason: e.target.value }))}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    >
                      <option value="Manual adjustment">Manual adjustment</option>
                      <option value="Expiry">Expiry</option>
                      <option value="Loss">Loss</option>
                      <option value="Damage">Damage</option>
                      <option value="Inventory Count">Inventory Count</option>
                      <option value="Return">Return</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <button 
                    onClick={handleApplyAdjustment}
                    disabled={isProcessing}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:bg-gray-300"
                  >
                    Apply Adjustment
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Overview & Transactions */}
        <div className="lg:col-span-8 space-y-8">
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 min-h-[38rem]">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xl font-bold text-gray-900">Stock Levels</h3>
              <div className="relative w-72">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                <input 
                  type="text"
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600 transition-all"
                />
              </div>
            </div>
            <div className="overflow-x-auto min-h-[30rem] max-h-[30rem] overflow-y-auto pr-2 custom-scrollbar border border-gray-100 rounded-2xl shadow-inner bg-gray-50/30">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-white z-10 shadow-sm text-[10px] uppercase font-bold text-gray-600 tracking-widest border-b border-gray-100">
                  <tr className="bg-white">
                    <th className="py-4 px-4">Product</th>
                    <th className="py-4 px-4">SKU</th>
                    <th className="py-4 px-4 text-right">Current Stock</th>
                    <th className="py-4 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {filteredProducts.map(p => (
                    <tr key={p.id} className="group hover:bg-indigo-50/30 transition-colors">
                      <td className="py-4 px-4">
                        <p className="text-sm font-bold text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-500 font-medium">{p.barcode}</p>
                      </td>
                      <td className="py-4 px-4 text-sm text-gray-500 font-mono font-bold">{p.sku}</td>
                      <td className="py-4 px-4 text-sm font-black text-right text-indigo-600">{p.stockQuantity.toLocaleString()} {p.unitType}</td>
                      <td className="py-4 px-4">
                        <div className="flex justify-center">
                          {p.stockQuantity <= (p.lowStockThreshold || 5) ? (
                            <span className="px-3 py-1 bg-red-50 text-red-600 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1.5 border border-red-100">
                              <AlertTriangle className="w-3 h-3" />
                              Low Stock
                            </span>
                          ) : (
                            <span className="px-3 py-1 bg-green-50 text-green-600 rounded-lg text-[10px] font-bold uppercase border border-green-100">
                              In Stock
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold text-gray-900 mb-8">Stock Movement</h3>
            <div className="max-h-112.5 overflow-y-auto pr-2 custom-scrollbar border border-gray-100 rounded-2xl p-6 shadow-inner bg-gray-50/30">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {transactions.map(t => {
                  const product = products.find(p => p.id === t.productId);
                  return (
                    <div key={t.id} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 hover:border-indigo-200 hover:shadow-md transition-all group">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 ${t.type === 'stock-in' ? 'bg-green-100 text-green-600' : t.type === 'adjustment' ? 'bg-indigo-100 text-indigo-600' : 'bg-red-100 text-red-600'}`}>
                          {t.type === 'stock-in' ? <ArrowUpRight className="w-6 h-6" /> : t.type === 'adjustment' ? <Settings className="w-6 h-6" /> : <ArrowDownRight className="w-6 h-6" />}
                        </div>
                        <div>
                          <p className="text-sm font-black text-gray-900">{product?.name || 'Unknown'}</p>
                          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">{t.reason || t.type}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-black ${t.type === 'stock-in' ? 'text-green-600' : t.type === 'adjustment' ? 'text-indigo-600' : 'text-red-600'}`}>
                          {t.type === 'stock-in' ? '+' : t.type === 'adjustment' ? '' : '-'}{t.quantity}
                        </p>
                        <p className="text-[10px] text-gray-400 font-bold">{t.timestamp?.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </div>
                  );
                })}
                {transactions.length === 0 && (
                  <div className="col-span-full text-center py-12">
                    <ClipboardList className="w-16 h-16 text-gray-100 mx-auto mb-4" />
                    <p className="text-sm font-bold text-gray-300 uppercase tracking-widest">No movements recorded</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
