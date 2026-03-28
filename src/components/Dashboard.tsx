import React, { useState, useEffect } from 'react';
import { 
  db, 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  limit,
  handleFirestoreError,
  OperationType,
  getDocs
} from '../data';
import { Sale, Product, Credit, SaleItem, Expense, CreditPayment } from '../types';
import { 
  TrendingUp, 
  TrendingDown,
  RotateCcw,
  Package, 
  ShoppingCart, 
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Users,
  Shield,
  Search,
  Printer,
  ChevronRight,
  CreditCard,
  DollarSign,
  Eye,
  CheckCircle,
  Receipt,
  X
} from 'lucide-react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import ReadinessPanel from './ReadinessPanel';
import { useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';

interface DashboardReceipt {
  id: string;
  timestamp: any;
  customerName: string;
  cashierName: string;
  paymentMethod: string;
  amount: number;
  type: 'sale' | 'credit_payment' | 'refund';
  balance?: number;
  saleId?: string;
  reference?: string;
  refundReason?: string;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [creditPayments, setCreditPayments] = useState<CreditPayment[]>([]);
  const [showHealth, setShowHealth] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [selectedCreditPayment, setSelectedCreditPayment] = useState<CreditPayment | null>(null);
  const [selectedSaleItems, setSelectedSaleItems] = useState<SaleItem[]>([]);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  useEffect(() => {
    if (!user) return;

    let unsubSales = () => {};
    let unsubProducts = () => {};
    let unsubRecent = () => {};
    let unsubCredits = () => {};
    let unsubExpenses = () => {};
    let unsubPayments = () => {};

    if ((user.role as string) === 'superadmin' || user.permissions.includes('dashboard')) {
      unsubSales = onSnapshot(collection(db, 'sales'), 
        (snapshot) => setSales(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'sales')
      );
      unsubRecent = onSnapshot(query(collection(db, 'sales'), orderBy('timestamp', 'desc'), limit(10)), 
        (snapshot) => setRecentSales(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'sales')
      );
      unsubCredits = onSnapshot(collection(db, 'credits'),
        (snapshot) => setCredits(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Credit))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'credits')
      );
      unsubExpenses = onSnapshot(collection(db, 'expenses'),
        (snapshot) => setExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'expenses')
      );
      unsubPayments = onSnapshot(query(collection(db, 'credit_payments'), orderBy('timestamp', 'desc'), limit(20)),
        (snapshot) => setCreditPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CreditPayment))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'credit_payments')
      );
    }

    if ((user.role as string) === 'superadmin' || user.permissions.includes('products')) {
      unsubProducts = onSnapshot(collection(db, 'products'), 
        (snapshot) => setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'products')
      );
    }

    return () => {
      unsubSales();
      unsubRecent();
      unsubCredits();
      unsubExpenses();
      unsubPayments();
      unsubProducts();
    };
  }, [user]);

  const today = new Date().toLocaleDateString();
  const todaySales = sales.filter(s => {
    const date = s.timestamp?.toDate().toLocaleDateString();
    return date === today;
  });

  const totalRevenue = todaySales.reduce((sum, s) => sum + (s.totalAmount - (s.refundAmount || 0)), 0);
  const totalRefunds = todaySales.reduce((sum, s) => sum + (s.refundAmount || 0), 0);
  const todayExpenses = expenses.filter(e => e.date?.toDate().toLocaleDateString() === today)
    .reduce((sum, e) => sum + e.amount, 0);
  const lowStockItems = products.filter(p => p.stockQuantity <= 5);
  const totalCredits = credits.reduce((sum, c) => sum + (c.status === 'open' ? c.outstandingBalance : 0), 0);

  const chartData = todaySales.map(s => ({
    time: s.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    amount: s.totalAmount
  })).reverse();

  const stats = [
    { label: "Today's Sales", value: `KES ${totalRevenue.toLocaleString()}`, icon: TrendingUp, color: "text-indigo-600", bg: "bg-indigo-50" },
    { label: "Today's Refunds", value: `KES ${totalRefunds.toLocaleString()}`, icon: RotateCcw, color: "text-red-600", bg: "bg-red-50" },
    { label: "Total Products", value: products.length, icon: Package, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Transactions", value: todaySales.length, icon: ShoppingCart, color: "text-indigo-600", bg: "bg-indigo-50" },
    { label: "Low Stock", value: lowStockItems.length, icon: AlertCircle, color: "text-red-600", bg: "bg-red-50" },
    { label: "Total Credits", value: `KES ${totalCredits.toLocaleString()}`, icon: DollarSign, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "Today's Expenses", value: `KES ${todayExpenses.toLocaleString()}`, icon: TrendingDown, color: "text-red-600", bg: "bg-red-50" },
  ];

  const allReceipts: DashboardReceipt[] = [
    ...recentSales.map(s => ({
      id: s.id,
      timestamp: s.timestamp,
      customerName: s.customerName || 'Walk-in Customer',
      cashierName: s.cashierName,
      paymentMethod: s.paymentMethod,
      amount: s.totalAmount,
      type: 'sale' as const,
      balance: s.paymentMethod === 'credit' ? s.outstandingBalance : 0
    })),
    ...recentSales.filter(s => (s.refundAmount || 0) > 0).map(s => ({
      id: `refund-${s.id}`,
      timestamp: s.timestamp,
      customerName: s.customerName || 'Walk-in Customer',
      cashierName: s.cashierName,
      paymentMethod: s.paymentMethod,
      amount: s.refundAmount || 0,
      type: 'refund' as const,
      balance: 0,
      refundReason: s.refundReason
    })),
    ...creditPayments.map(p => {
      const credit = credits.find(c => c.id === p.creditId);
      return {
        id: p.id,
        timestamp: p.timestamp,
        customerName: credit?.customerName || 'Unknown Customer',
        cashierName: p.cashierName,
        paymentMethod: p.paymentMethod,
        amount: p.amountPaid,
        type: 'credit_payment' as const,
        balance: p.remainingBalance !== undefined ? p.remainingBalance : (credit?.outstandingBalance || 0),
        saleId: p.saleId,
        reference: p.reference
      };
    })
  ].sort((a, b) => {
    const timeA = a.timestamp?.toDate?.()?.getTime() || a.timestamp?.seconds * 1000 || 0;
    const timeB = b.timestamp?.toDate?.()?.getTime() || b.timestamp?.seconds * 1000 || 0;
    return timeB - timeA;
  });

  const filteredReceipts = allReceipts.filter(receipt => 
    receipt.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    receipt.customerName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    receipt.cashierName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    receipt.saleId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    receipt.refundReason?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handlePrintReceipt = async (receipt: DashboardReceipt) => {
    setIsPrinting(true);
    try {
      if (receipt.type === 'sale' || receipt.type === 'refund') {
        const sale = sales.find(s => s.id === receipt.id);
        if (sale) {
          const itemsSnapshot = await getDocs(collection(db, `sales/${sale.id}/items`));
          const items = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SaleItem));
          setSelectedSale(sale);
          setSelectedCreditPayment(null);
          setSelectedSaleItems(items);
        }
      } else {
        const payment = creditPayments.find(p => p.id === receipt.id);
        if (payment) {
          setSelectedCreditPayment(payment);
          setSelectedSale(null);
          setSelectedSaleItems([]);
        }
      }
      
      setTimeout(() => {
        window.print();
        setIsPrinting(false);
      }, 1000);
    } catch (error) {
      console.error('Error fetching receipt details:', error);
      setIsPrinting(false);
    }
  };

  const handlePreviewReceipt = async (receipt: DashboardReceipt) => {
    try {
      if (receipt.type === 'sale' || receipt.type === 'refund') {
        const sale = sales.find(s => s.id === receipt.id);
        if (sale) {
          const itemsSnapshot = await getDocs(collection(db, `sales/${sale.id}/items`));
          const items = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SaleItem));
          setSelectedSale(sale);
          setSelectedCreditPayment(null);
          setSelectedSaleItems(items);
          setIsPreviewOpen(true);
        }
      } else {
        const payment = creditPayments.find(p => p.id === receipt.id);
        if (payment) {
          setSelectedCreditPayment(payment);
          setSelectedSale(null);
          setSelectedSaleItems([]);
          setIsPreviewOpen(true);
        }
      }
    } catch (error) {
      console.error('Error fetching preview details:', error);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard Overview</h1>
          <p className="text-gray-500">Welcome back, {user?.displayName}! Here's what's happening today.</p>
        </div>
        {(user?.role === 'superadmin' || user?.permissions?.includes('status')) && (
          <button 
            onClick={() => setShowHealth(!showHealth)}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all ${showHealth ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-white text-gray-600 border border-gray-100 hover:border-indigo-600 hover:text-indigo-600'}`}
          >
            <Shield className="w-5 h-5" />
            {showHealth ? 'Hide System Status' : 'Check System Status'}
          </button>
        )}
      </div>

      {showHealth && ['superadmin', 'admin'].includes(user?.role || '') && (
        <div className="animate-in fade-in slide-in-from-top-4 duration-300">
          <ReadinessPanel />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-4xl shadow-sm border border-gray-100 flex items-center gap-4">
            <div className={`p-3 rounded-2xl ${stat.bg} ${stat.color}`}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[10px] text-gray-600 font-bold uppercase tracking-wider">{stat.label}</p>
              <p className="text-xl font-black text-gray-900">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Sales Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-4xl shadow-sm border border-gray-100 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-900">Sales Velocity</h3>
            <select className="text-sm font-bold text-gray-500 border-none bg-gray-50 rounded-xl px-4 py-2 outline-none">
              <option>Today</option>
              <option>Last 7 Days</option>
            </select>
          </div>
          <div className="h-50 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 700, fill: '#9ca3af'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 700, fill: '#9ca3af'}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                />
                <Area type="monotone" dataKey="amount" stroke="#4f46e5" strokeWidth={4} fillOpacity={1} fill="url(#colorAmount)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Sales */}
        <div className="bg-white p-6 rounded-4xl shadow-sm border border-gray-100">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Recent Transactions</h3>
          <div className="space-y-3 max-h-75 overflow-y-auto pr-2 custom-scrollbar">
            {recentSales.map(sale => (
              <div key={sale.id} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-2xl transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                    <Users className="w-5 h-5 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{sale.cashierName}</p>
                    <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">{sale.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-indigo-600">KES {sale.totalAmount.toLocaleString()}</p>
                  <p className="text-[10px] uppercase font-bold text-gray-600 tracking-widest">{sale.paymentMethod}</p>
                </div>
              </div>
            ))}
            {recentSales.length === 0 && (
              <div className="text-center py-8">
                <ShoppingCart className="w-10 h-10 text-gray-100 mx-auto mb-2" />
                <p className="text-sm font-bold text-gray-300 uppercase tracking-widest">No sales yet today</p>
              </div>
            )}
          </div>
          <button className="w-full mt-4 py-3 text-sm font-bold text-indigo-600 bg-indigo-50 rounded-2xl hover:bg-indigo-100 transition-all">
            View All Reports
          </button>
        </div>
      </div>

      {/* Printable Receipts Section */}
      <div className="bg-white p-8 rounded-4xl shadow-sm border border-gray-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Printable Receipts</h3>
            <p className="text-sm text-gray-500">Search and print receipts for recent transactions.</p>
          </div>
          <div className="relative w-full md:w-96">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input 
              type="text"
              placeholder="Search by ID, Customer, or Cashier..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-medium"
            />
          </div>
        </div>

        <div className="overflow-x-auto max-h-100 overflow-y-auto pr-2 custom-scrollbar border border-gray-50 rounded-2xl shadow-inner bg-gray-50/30">
          <table className="w-full">
            <thead className="sticky top-0 bg-white z-10 shadow-sm">
              <tr className="text-left border-b border-gray-100">
                <th className="px-4 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Receipt ID</th>
                <th className="px-4 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Date & Time</th>
                <th className="px-4 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Customer</th>
                <th className="px-4 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Amount</th>
                <th className="px-4 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Balance</th>
                <th className="px-4 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredReceipts.map((receipt) => (
                <tr key={`${receipt.id}-${receipt.type}`} className="group hover:bg-indigo-50/30 transition-colors">
                  <td className="px-4 py-4">
                    <button 
                      onClick={() => handlePreviewReceipt(receipt)}
                      className="text-xs font-mono font-bold text-indigo-600 hover:underline"
                    >
                      #{receipt.id.slice(-8).toUpperCase()}
                    </button>
                    {receipt.type === 'credit_payment' && (
                      <p className="text-[8px] text-amber-600 font-bold uppercase mt-1">Credit Payment</p>
                    )}
                    {receipt.type === 'refund' && (
                      <p className="text-[8px] text-red-600 font-bold uppercase mt-1">Refund</p>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <p className="text-sm font-bold text-gray-900">{receipt.timestamp?.toDate().toLocaleDateString()}</p>
                    <p className="text-[10px] font-bold text-gray-500">{receipt.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="text-sm font-bold text-gray-900">{receipt.customerName}</p>
                    <p className="text-[10px] font-bold text-gray-500">Cashier: {receipt.cashierName}</p>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <p className={`text-sm font-black ${receipt.type === 'refund' ? 'text-red-600' : 'text-gray-900'}`}>
                      {receipt.type === 'refund' ? '-' : ''}KES {receipt.amount.toLocaleString()}
                    </p>
                    <span className={`px-2 py-0.5 rounded-lg text-[8px] font-bold uppercase tracking-wider ${
                      receipt.type === 'refund' ? 'bg-red-50 text-red-600' :
                      receipt.paymentMethod === 'cash' ? 'bg-green-50 text-green-600' :
                      receipt.paymentMethod === 'mpesa' ? 'bg-indigo-50 text-indigo-600' :
                      receipt.paymentMethod === 'credit' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'
                    }`}>
                      {receipt.type === 'refund' ? 'Refund' : receipt.paymentMethod}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <p className={`text-sm font-bold ${receipt.balance && receipt.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      KES {receipt.balance?.toLocaleString() || 0}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => handlePreviewReceipt(receipt)}
                        className="p-2 bg-gray-100 text-gray-600 rounded-xl hover:bg-indigo-600 hover:text-white transition-all"
                        title="Preview Receipt"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handlePrintReceipt(receipt)}
                        disabled={isPrinting}
                        className="p-2 bg-gray-100 text-gray-600 rounded-xl hover:bg-indigo-600 hover:text-white transition-all disabled:opacity-50"
                        title="Print Receipt"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredReceipts.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Search className="w-8 h-8 text-gray-200" />
                      <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">No receipts found</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {/* Preview Modal */}
      <AnimatePresence>
        {isPreviewOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-4xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl">
                    <Receipt className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900">Receipt Preview</h3>
                </div>
                <button 
                  onClick={() => setIsPreviewOpen(false)}
                  className="p-2 hover:bg-gray-200 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="p-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <div className="bg-gray-50 p-6 rounded-2xl border border-dashed border-gray-200 font-mono text-sm space-y-4">
                  <div className="text-center space-y-1">
                    <h4 className="font-black text-base uppercase">KingKush Supermarket</h4>
                    <p className="text-xs text-gray-500">1331-60100-Embu</p>
                    <p className="text-xs text-gray-500">Tel: +254 701137747</p>
                  </div>

                  <div className="border-t border-dashed border-gray-200 pt-4 space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span>Date:</span>
                      <span>{(selectedSale?.timestamp || selectedCreditPayment?.timestamp)?.toDate().toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Time:</span>
                      <span>{(selectedSale?.timestamp || selectedCreditPayment?.timestamp)?.toDate().toLocaleTimeString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Receipt #:</span>
                      <span className="font-bold">{(selectedSale?.id || selectedCreditPayment?.id)?.toUpperCase()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cashier:</span>
                      <span>{(selectedSale?.cashierName || selectedCreditPayment?.cashierName)?.toUpperCase()}</span>
                    </div>
                    {(selectedSale?.customerName || selectedCreditPayment?.creditId) && (
                      <div className="flex justify-between">
                        <span>Customer:</span>
                        <span>{
                          selectedSale?.customerName || 
                          credits.find(c => c.id === selectedCreditPayment?.creditId)?.customerName
                        }</span>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-dashed border-gray-200 pt-4">
                    {selectedSale ? (
                      <div className="space-y-2">
                        <div className="flex justify-between font-bold text-xs border-b border-dashed border-gray-200 pb-2">
                          <span className="w-1/2">Item</span>
                          <span className="w-1/4 text-right">Qty</span>
                          <span className="w-1/4 text-right">Total</span>
                        </div>
                        {selectedSaleItems.map((item, idx) => (
                          <div key={idx} className="flex justify-between text-xs">
                            <span className="w-1/2 truncate">{item.productName}</span>
                            <span className="w-1/4 text-right">{item.quantity}</span>
                            <span className="w-1/4 text-right">{item.totalPrice.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    ) : selectedCreditPayment ? (
                      <div className="space-y-2">
                        <div className="flex justify-between font-bold text-xs border-b border-dashed border-gray-200 pb-2">
                          <span>Description</span>
                          <span>Amount</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span>Credit Payment</span>
                          <span>{selectedCreditPayment.amountPaid.toLocaleString()}</span>
                        </div>
                        {selectedCreditPayment.reference && (
                          <div className="flex justify-between text-xs text-gray-500">
                            <span>Ref:</span>
                            <span>{selectedCreditPayment.reference}</span>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="border-t border-dashed border-gray-200 pt-4 space-y-2">
                    <div className="flex justify-between font-black text-base">
                      <span>TOTAL</span>
                      <span>KES {(selectedSale?.totalAmount || selectedCreditPayment?.amountPaid || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Method:</span>
                      <span className="uppercase">{selectedSale?.paymentMethod || selectedCreditPayment?.paymentMethod}</span>
                    </div>
                    {selectedCreditPayment && (
                      <div className="flex justify-between text-xs font-bold text-red-600">
                        <span>REMAINING BALANCE:</span>
                        <span>KES {(selectedCreditPayment.remainingBalance !== undefined ? selectedCreditPayment.remainingBalance : (credits.find(c => c.id === selectedCreditPayment.creditId)?.outstandingBalance || 0)).toLocaleString()}</span>
                      </div>
                    )}
                    {selectedSale?.paymentMethod === 'credit' && (
                      <div className="flex justify-between text-xs font-bold text-red-600">
                        <span>CREDIT BALANCE:</span>
                        <span>KES {selectedSale.outstandingBalance.toLocaleString()}</span>
                      </div>
                    )}
                  </div>

                  <div className="text-center pt-4 text-[10px] text-gray-400">
                    <p className="font-bold mb-1 uppercase">All goods are inclusive of vat</p>
                    <p>THANK YOU FOR SHOPPING WITH US!</p>
                    <p className="mt-1">Created by Noxira labs(+254 701137747)</p>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-4">
                <button 
                  onClick={() => setIsPreviewOpen(false)}
                  className="flex-1 py-3 px-4 bg-white text-gray-600 font-bold rounded-2xl border border-gray-200 hover:bg-gray-50 transition-all"
                >
                  Close
                </button>
                <button 
                  onClick={() => {
                    const receipt = allReceipts.find(r => r.id === (selectedSale?.id || selectedCreditPayment?.id));
                    if (receipt) handlePrintReceipt(receipt);
                  }}
                  className="flex-1 py-3 px-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all flex items-center justify-center gap-2"
                >
                  <Printer className="w-5 h-5" />
                  Print Now
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Hidden Thermal Receipt for Printing */}
      <div id="thermal-receipt" className="hidden print:block font-mono text-[12px] leading-tight p-4 w-[80mm]">
        {(selectedSale || selectedCreditPayment) && (
          <>
            <div className="text-center mb-4">
              <h1 className="font-bold text-lg uppercase">KingKush Supermarket</h1>
              <p>1331-60100-Embu</p>
              <p>Tel: +254 701137747</p>
              <p className="mt-2">********************************</p>
            </div>
            
            <div className="mb-2">
              <div className="flex justify-between">
                <span>DATE: {(selectedSale?.timestamp || selectedCreditPayment?.timestamp)?.toDate().toLocaleDateString()}</span>
                <span>TIME: {(selectedSale?.timestamp || selectedCreditPayment?.timestamp)?.toDate().toLocaleTimeString()}</span>
              </div>
              <p>RECEIPT #: {(selectedSale?.id || selectedCreditPayment?.id)?.toUpperCase()}</p>
              <p>CASHIER: {(selectedSale?.cashierName || selectedCreditPayment?.cashierName)?.toUpperCase()}</p>
              {(selectedSale?.customerName || selectedCreditPayment?.creditId) && (
                <p>CUSTOMER: {
                  (selectedSale?.customerName || 
                  credits.find(c => c.id === selectedCreditPayment?.creditId)?.customerName || '').toUpperCase()
                }</p>
              )}
              <p>********************************</p>
            </div>

            <div className="mb-4">
              {selectedSale ? (
                <>
                  <div className="flex justify-between font-bold mb-1 border-b border-dashed border-gray-300 pb-1">
                    <span className="w-1/2">ITEM</span>
                    <span className="w-1/4 text-right">QTY</span>
                    <span className="w-1/4 text-right">TOTAL</span>
                  </div>
                  {selectedSaleItems.map((item, idx) => (
                    <div key={idx} className="flex justify-between py-0.5">
                      <span className="w-1/2 truncate">{item.productName}</span>
                      <span className="w-1/4 text-right">{item.quantity}</span>
                      <span className="w-1/4 text-right">{item.totalPrice.toLocaleString()}</span>
                    </div>
                  ))}
                </>
              ) : selectedCreditPayment ? (
                <>
                  <div className="flex justify-between font-bold mb-1 border-b border-dashed border-gray-300 pb-1">
                    <span>DESCRIPTION</span>
                    <span className="text-right">AMOUNT</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span>CREDIT PAYMENT</span>
                    <span className="text-right">{selectedCreditPayment.amountPaid.toLocaleString()}</span>
                  </div>
                  {selectedCreditPayment.reference && (
                    <p className="text-[10px]">REF: {selectedCreditPayment.reference}</p>
                  )}
                </>
              ) : null}
              <p className="mt-1 border-t border-dashed border-gray-300 pt-1">********************************</p>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between font-bold text-sm">
                <span>TOTAL</span>
                <span>KES {(selectedSale?.totalAmount || selectedCreditPayment?.amountPaid || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>PAYMENT ({ (selectedSale?.paymentMethod || selectedCreditPayment?.paymentMethod || '').toUpperCase() })</span>
                <span>KES {(selectedSale?.amountPaid || selectedCreditPayment?.amountPaid || 0).toLocaleString()}</span>
              </div>
              {selectedSale && (
                <div className="flex justify-between">
                  <span>CHANGE</span>
                  <span>KES {selectedSale.balance.toLocaleString()}</span>
                </div>
              )}
              {selectedCreditPayment && (
                <div className="flex justify-between font-bold">
                  <span>REMAINING BALANCE</span>
                  <span>KES {(selectedCreditPayment.remainingBalance !== undefined ? selectedCreditPayment.remainingBalance : (credits.find(c => c.id === selectedCreditPayment.creditId)?.outstandingBalance || 0)).toLocaleString()}</span>
                </div>
              )}
              {selectedSale?.paymentMethod === 'credit' && (
                <div className="flex justify-between font-bold">
                  <span>CREDIT BALANCE</span>
                  <span>KES {selectedSale.outstandingBalance.toLocaleString()}</span>
                </div>
              )}
            </div>

            <div className="text-center border-t border-dashed border-gray-300 pt-4 mt-4">
              <p className="font-bold mb-1 uppercase">All goods are inclusive of vat</p>
              <p>THANK YOU FOR SHOPPING WITH US!</p>
              <p>Goods once sold are not returnable.</p>
              <p className="mt-2 text-[10px]">Created by Noxira labs(+254 701137747)</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
