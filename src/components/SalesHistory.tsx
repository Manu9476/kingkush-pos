import { useState, useEffect } from 'react';
import { 
  db, 
  collection, 
  doc,
  getDoc,
  query, 
  orderBy, 
  onSnapshot, 
  toDate
} from '../data';
import { Branch, Sale, SaleItem, SystemSettings } from '../types';
import { 
  Search, 
  RotateCcw, 
  ChevronRight, 
  Printer,
  AlertCircle,
  CheckCircle,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from './ConfirmDialog';
import { refundSale } from '../services/platformApi';
import { formatRefundReceiptNumber, getReceiptIdentity, resolveReceiptBranch } from '../utils/receipts';

export default function SalesHistory() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [isRefunding, setIsRefunding] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [, setIsPrinting] = useState(false);

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

  const handlePrintRefund = () => {
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 500);
  };

  useEffect(() => {
    const q = query(collection(db, 'sales'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const salesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale));
      setSales(salesData);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribeBranches = onSnapshot(collection(db, 'branches'), (snapshot) => {
      setBranches(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Branch)));
    });

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
    return () => unsubscribeBranches();
  }, []);

  useEffect(() => {
    if (selectedSale) {
      const q = query(collection(db, `sales/${selectedSale.id}/items`));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        setSaleItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SaleItem)));
      });
      return () => unsubscribe();
    }
  }, [selectedSale]);

  useEffect(() => {
    if (!selectedSale) {
      return;
    }

    const latestSale = sales.find((sale) => sale.id === selectedSale.id);
    if (!latestSale) {
      return;
    }

    const hasMeaningfulChange =
      latestSale.isRefunded !== selectedSale.isRefunded ||
      latestSale.refundAmount !== selectedSale.refundAmount ||
      latestSale.refundedAt !== selectedSale.refundedAt ||
      latestSale.refundedBy !== selectedSale.refundedBy ||
      latestSale.refundReason !== selectedSale.refundReason ||
      latestSale.outstandingBalance !== selectedSale.outstandingBalance;

    if (hasMeaningfulChange) {
      setSelectedSale((current) => current ? { ...current, ...latestSale } : current);
    }
  }, [sales, selectedSale]);

  const handlePartialRefund = async (item: SaleItem) => {
    if (!selectedSale || !refundReason.trim()) {
      toast.error('Please provide a refund reason first.');
      return;
    }
    if (item.isRefunded) return;
    
    setConfirmConfig({
      isOpen: true,
      title: 'Confirm Partial Refund',
      message: `Are you sure you want to refund ${item.productName || item.name}? This will restore stock.`,
      onConfirm: async () => {
        setIsRefunding(true);
        try {
          const response = await refundSale({
            saleId: selectedSale.id,
            refundReason,
            itemId: item.id
          });
          setSelectedSale((current) => current ? { ...current, ...response.sale } : current);
          setSaleItems((current) =>
            current.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    isRefunded: true,
                    status: 'refunded',
                    refundedAt: response.sale.refundedAt,
                    refundedBy: response.sale.refundedBy
                  }
                : entry
            )
          );
          setRefundReason('');
          toast.success('Item refunded successfully. Stock levels updated.');
        } catch (error) {
          console.error('Partial refund error:', error);
          toast.error('Failed to process partial refund.');
        } finally {
          setIsRefunding(false);
        }
      },
      type: 'danger'
    });
  };

  const handleRefund = async () => {
    if (!selectedSale || !refundReason.trim()) return;
    
    setConfirmConfig({
      isOpen: true,
      title: 'Confirm Full Refund',
      message: 'Are you sure you want to refund this entire sale? This will restore stock levels for all items.',
      onConfirm: async () => {
        setIsRefunding(true);
        try {
          const response = await refundSale({
            saleId: selectedSale.id,
            refundReason
          });
          setSelectedSale((current) => current ? { ...current, ...response.sale } : current);
          setSaleItems((current) =>
            current.map((entry) => ({
              ...entry,
              isRefunded: true,
              status: 'refunded',
              refundedAt: response.sale.refundedAt,
              refundedBy: response.sale.refundedBy
            }))
          );
          setRefundReason('');
          toast.success('Refund processed successfully. Stock levels restored.');
        } catch (error) {
          console.error('Refund error:', error);
          toast.error('Failed to process refund.');
        } finally {
          setIsRefunding(false);
        }
      },
      type: 'danger'
    });
  };

  const filteredSales = sales.filter(s => 
    s.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.customerName?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const hasRefundActivity = Boolean(
    selectedSale && ((selectedSale.refundAmount || 0) > 0 || saleItems.some((item) => item.isRefunded))
  );
  const refundReceiptBranch = resolveReceiptBranch(branches, selectedSale?.branchId, settings?.defaultBranchId);
  const refundReceiptIdentity = getReceiptIdentity(settings, refundReceiptBranch);

  return (
    <div className="space-y-6">
      <ConfirmDialog
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
        type={confirmConfig.type}
      />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Sales History & Refunds</h1>
          <p className="text-gray-500 font-medium">View past transactions and process returns</p>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input 
              type="text"
              placeholder="Search by Receipt ID or Customer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
          </div>
        </div>
        <div className="overflow-x-auto max-h-137.5 overflow-y-auto pr-2 custom-scrollbar border border-gray-100 rounded-2xl shadow-inner bg-gray-50/30">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-white z-10 shadow-sm">
              <tr className="bg-white">
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100">Receipt ID</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100">Date & Time</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100">Customer</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right border-b border-gray-100">Total</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center border-b border-gray-100">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                  </td>
                </tr>
              ) : filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">No sales found</td>
                </tr>
              ) : filteredSales.map((sale) => (
                <tr key={sale.id} className="hover:bg-gray-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs font-bold text-indigo-600">#{sale.id.slice(-8).toUpperCase()}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-gray-900">
                      {toDate(sale.timestamp).toLocaleDateString()}
                    </div>
                    <div className="text-[10px] text-gray-400 font-medium">
                      {toDate(sale.timestamp).toLocaleTimeString()}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-gray-900">{sale.customerName || 'Walk-in Customer'}</div>
                    <div className="text-[10px] text-gray-400 font-medium">{sale.paymentMethod.toUpperCase()}</div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-black text-gray-900">KES {sale.totalAmount.toLocaleString()}</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {sale.isRefunded ? (
                      <span className="px-3 py-1 bg-red-100 text-red-600 rounded-full text-[10px] font-bold uppercase tracking-wider">Refunded</span>
                    ) : (sale.refundAmount || 0) > 0 ? (
                      <span className="px-3 py-1 bg-amber-100 text-amber-600 rounded-full text-[10px] font-bold uppercase tracking-wider">Partial Refund</span>
                    ) : (
                      <span className="px-3 py-1 bg-green-100 text-green-600 rounded-full text-[10px] font-bold uppercase tracking-wider">Completed</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => setSelectedSale(sale)}
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

      {/* Sale Details Modal */}
      {selectedSale && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 bg-indigo-600 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold text-lg">Sale Details</h3>
                <p className="text-indigo-100 text-xs">Receipt #{selectedSale.id.toUpperCase()}</p>
              </div>
              <button onClick={() => setSelectedSale(null)} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Customer</p>
                  <p className="text-sm font-bold text-gray-900">{selectedSale.customerName || 'Walk-in Customer'}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Payment Method</p>
                  <p className="text-sm font-bold text-gray-900 uppercase">{selectedSale.paymentMethod}</p>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Items Purchased</h4>
                <div className="space-y-3">
                  {saleItems.map((item, idx) => (
                    <div key={idx} className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${item.isRefunded ? 'bg-red-50 border-red-100 opacity-75' : 'bg-gray-50 border-gray-100'}`}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-gray-900">{item.name || item.productName || 'Unknown Product'}</p>
                          {item.isRefunded && (
                            <span className="px-2 py-0.5 bg-red-600 text-white text-[8px] font-black uppercase rounded-full">Refunded</span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500 font-medium">KES {(item.sellingPrice || item.unitPrice || 0).toLocaleString()} x {item.quantity}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <p className={`text-sm font-black ${item.isRefunded ? 'text-red-600 line-through' : 'text-gray-900'}`}>
                          KES {((item.sellingPrice || item.unitPrice || 0) * item.quantity).toLocaleString()}
                        </p>
                        {!selectedSale.isRefunded && !item.isRefunded && (
                          <button 
                            onClick={() => handlePartialRefund(item)}
                            disabled={isRefunding || !refundReason.trim()}
                            className="p-2 text-red-600 hover:bg-red-100 rounded-xl transition-all disabled:opacity-50"
                            title="Refund this item"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-gray-100 pt-6 space-y-2">
                <div className="flex justify-between text-gray-500">
                  <span className="text-sm font-medium">Subtotal</span>
                  <span className="text-sm font-bold">KES {selectedSale.totalAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span className="text-sm font-medium">VAT</span>
                  <span className="text-sm font-bold">KES {(selectedSale.taxAmount || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-gray-900 pt-2">
                  <span className="text-lg font-black">Total</span>
                  <span className="text-lg font-black">KES {selectedSale.totalAmount.toLocaleString()}</span>
                </div>
              </div>

              {!selectedSale.isRefunded && (
                <div className="bg-red-50 p-6 rounded-3xl border border-red-100 space-y-4">
                  <div className="flex items-center gap-3 text-red-600">
                    <AlertCircle className="w-6 h-6" />
                    <h4 className="font-bold">Process Refund</h4>
                  </div>
                  <p className="text-sm text-red-600/80 font-medium">
                    Refunding this sale will restore stock levels for all items. This action cannot be undone.
                  </p>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Reason for Refund</label>
                    <textarea 
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      placeholder="e.g. Defective item, Customer changed mind..."
                  className="w-full p-4 bg-white border border-red-100 rounded-2xl focus:ring-2 focus:ring-red-500 outline-none text-sm min-h-25"
                    />
                  </div>
                  <button 
                    onClick={handleRefund}
                    disabled={isRefunding || !refundReason.trim()}
                    className="w-full py-4 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
                  >
                    {isRefunding ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <RotateCcw className="w-5 h-5" />
                        Complete Full Refund
                      </>
                    )}
                  </button>
                </div>
              )}

              {hasRefundActivity && (
                <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 space-y-2">
                  <div className="flex items-center gap-3 text-gray-400">
                    <CheckCircle className="w-6 h-6" />
                    <h4 className="font-bold">{selectedSale.isRefunded ? 'Refunded' : 'Refund Activity Recorded'}</h4>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="text-gray-400 font-bold uppercase tracking-widest mb-1">Refunded At</p>
                      <p className="text-gray-900 font-bold">{selectedSale.refundedAt ? new Date(selectedSale.refundedAt).toLocaleString() : 'Pending sync'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-bold uppercase tracking-widest mb-1">Processed By</p>
                      <p className="text-gray-900 font-bold">{selectedSale.refundedBy || 'Pending sync'}</p>
                    </div>
                  </div>
                  <div className="pt-2">
                    <p className="text-gray-400 font-bold uppercase tracking-widest mb-1">Reason</p>
                    <p className="text-gray-900 font-medium italic">"{selectedSale.refundReason || 'No reason recorded'}"</p>
                  </div>
                  <button 
                    onClick={handlePrintRefund}
                    className="w-full mt-4 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                  >
                    <Printer className="w-5 h-5" />
                    Print Refund Receipt
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hidden Refund Receipt for Printing */}
      <div id="refund-receipt" className="hidden print:block font-mono text-[12px] leading-tight p-4 w-[80mm]">
        {selectedSale && hasRefundActivity && (
          <>
            <div className="text-center mb-4">
              <h1 className="font-bold text-lg uppercase">{refundReceiptIdentity.businessName}</h1>
              <p className="text-sm font-bold">REFUND RECEIPT</p>
              {refundReceiptIdentity.branchName && <p>{refundReceiptIdentity.branchName}</p>}
              {refundReceiptIdentity.address && <p>{refundReceiptIdentity.address}</p>}
              {refundReceiptIdentity.phone && <p>Tel: {refundReceiptIdentity.phone}</p>}
              <p className="mt-2">********************************</p>
            </div>
            
            <div className="mb-2">
              <p>DATE: {selectedSale.refundedAt ? new Date(selectedSale.refundedAt).toLocaleDateString() : toDate(selectedSale.timestamp).toLocaleDateString()}</p>
              <p>TIME: {selectedSale.refundedAt ? new Date(selectedSale.refundedAt).toLocaleTimeString() : toDate(selectedSale.timestamp).toLocaleTimeString()}</p>
              <p>REFUND #: {formatRefundReceiptNumber(selectedSale.id)}</p>
              <p>ORIGINAL SALE: #{selectedSale.id.toUpperCase()}</p>
              <p>REFUNDED BY: {(selectedSale.refundedBy || 'SYSTEM').toUpperCase()}</p>
              <p>CUSTOMER: {(selectedSale.customerName || 'Walk-in').toUpperCase()}</p>
              <p>STATUS: {selectedSale.isRefunded ? 'FULL REFUND' : 'PARTIAL REFUND'}</p>
              <p>********************************</p>
            </div>

            <div className="mb-4">
              <p className="font-bold mb-1">REFUNDED ITEMS:</p>
              <div className="flex justify-between font-bold mb-1 border-b border-dashed border-gray-300 pb-1">
                <span className="w-1/2">ITEM</span>
                <span className="w-1/4 text-right">QTY</span>
                <span className="w-1/4 text-right">TOTAL</span>
              </div>
              {saleItems.filter(item => item.isRefunded).map((item, idx) => (
                <div key={idx} className="flex justify-between py-0.5">
                  <span className="w-1/2 truncate">{item.name || item.productName}</span>
                  <span className="w-1/4 text-right">{item.quantity}</span>
                  <span className="w-1/4 text-right">{((item.sellingPrice || item.unitPrice || 0) * item.quantity).toLocaleString()}</span>
                </div>
              ))}
              <p className="mt-1 border-t border-dashed border-gray-300 pt-1">********************************</p>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between font-bold text-sm">
                <span>TOTAL REFUND</span>
                <span>KES {(selectedSale.refundAmount || selectedSale.totalAmount).toLocaleString()}</span>
              </div>
              <div className="mt-2">
                <p className="text-[10px] font-bold uppercase">REASON:</p>
                <p className="italic text-[10px]">{selectedSale.refundReason || 'No reason recorded'}</p>
              </div>
            </div>

            <div className="text-center border-t border-dashed border-gray-300 pt-4 mt-4">
              <p className="font-bold mb-1 uppercase">{refundReceiptIdentity.header}</p>
              <p>REFUND PROCESSED SUCCESSFULLY</p>
              <p>{refundReceiptIdentity.footer}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
