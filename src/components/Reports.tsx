import { useState, useEffect } from 'react';
import {
  db,
  collection,
  getDocs,
  query,
  orderBy,
  where,
  getDoc,
  doc,
  collectionGroup,
  handleFirestoreError,
  OperationType,
  toDate
} from '../data';
import { Sale, Product, Expense } from '../types';
import { useAuth } from '../App';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar
} from 'recharts';
import { Calendar, Download, FileText, TrendingUp, Package, DollarSign, AlertTriangle, Clock } from 'lucide-react';
import { toast } from 'sonner';

export default function Reports() {
  const { user } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [credits, setCredits] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [activePeriod, setActivePeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  useEffect(() => {
      const fetchData = async () => {
      if (!user) return;
      try {
        const salesSnapshot = await getDocs(query(collection(db, 'sales'), orderBy('timestamp', 'desc')));
        const salesData = salesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale));
        setSales(salesData);

        const productsSnapshot = await getDocs(collection(db, 'products'));
        const productsData = productsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
        setProducts(productsData);

        const expensesSnapshot = await getDocs(query(collection(db, 'expenses'), orderBy('date', 'desc')));
        const expensesData = expensesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense));
        setExpenses(expensesData);

        const creditsSnapshot = await getDocs(query(collection(db, 'credits'), where('status', '==', 'open')));
        setCredits(creditsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));

        const settingsDoc = await getDoc(doc(db, 'settings', 'system'));
        if (settingsDoc.exists()) {
          setSettings(settingsDoc.data());
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'reports');
      }
    };
    fetchData();
  }, [user]);

  const totalRevenue = sales.reduce((sum, s) => sum + (s.totalAmount - (s.refundAmount || 0)), 0);
  const avgSale = sales.length > 0 ? totalRevenue / sales.length : 0;

  const lowStockProducts = products.filter(p => p.stockQuantity <= (p.lowStockThreshold || 5));

  const calculateDebtAging = () => {
    const now = new Date();
    const badDebtThreshold = settings?.badDebtThresholdDays || 90;
    
    const aging = {
      current: 0, // 0-30 days
      overdue: 0, // 31-60 days
      critical: 0, // 61-90 days
      badDebt: 0 // Threshold+ days
    };

    credits.forEach(c => {
      const creditDate = c.timestamp?.toDate() || new Date();
      const diffDays = Math.floor((now.getTime() - creditDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays >= badDebtThreshold) {
        aging.badDebt += c.outstandingBalance;
      } else if (diffDays > 60) {
        aging.critical += c.outstandingBalance;
      } else if (diffDays > 30) {
        aging.overdue += c.outstandingBalance;
      } else {
        aging.current += c.outstandingBalance;
      }
    });

    return [
      { name: '0-30 Days', value: aging.current },
      { name: '31-60 Days', value: aging.overdue },
      { name: '61-90 Days', value: aging.critical },
      { name: `${badDebtThreshold}+ Days (Bad Debt)`, value: aging.badDebt },
    ];
  };

  const debtAgingData = calculateDebtAging();

  const getFilteredData = (period: 'daily' | 'weekly' | 'monthly') => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let startDate: Date;
    if (period === 'daily') {
      startDate = startOfToday;
    } else if (period === 'weekly') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1); // Start of month
    }

    const filteredSales = sales.filter(s => toDate(s.timestamp) >= startDate);
    const filteredExpenses = expenses.filter(e => toDate(e.date) >= startDate);

    return { filteredSales, filteredExpenses };
  };

  const calculateProfitEstimate = (period: 'daily' | 'weekly' | 'monthly') => {
    const { filteredSales } = getFilteredData(period);
    const totalRevenue = filteredSales.reduce((sum, s) => sum + (s.totalAmount - (s.refundAmount || 0)), 0);
    const totalCost = totalRevenue * 0.88; 
    const profit = totalRevenue - totalCost;

    return {
      estimated_cost: Math.round(totalCost),
      estimated_profit: Math.round(profit),
      revenue: Math.round(totalRevenue),
      period
    };
  };

  const profitStats = calculateProfitEstimate(activePeriod);

  const downloadCSV = (data: Record<string, unknown>[], filename: string, title?: string) => {
    if (data.length === 0) {
      toast.error("No data to export");
      return;
    }

    const headers = Object.keys(data[0]);
    const generationTime = new Date().toLocaleString();
    
    let csvContent = '';
    csvContent += `"${title || 'Sales Report'}"\n`;
    csvContent += `"Generated At:","${generationTime}"\n`;
    csvContent += `"Generated By:","${user?.displayName || user?.username || 'System'}"\n\n`;

    csvContent += headers.join(',') + '\n';
    csvContent += data.map(row => headers.map(header => {
      const value = row[header] ?? '';
      const escaped = String(value).replace(/"/g, '""');
      return `"${escaped}"`;
    }).join(',')).join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportDailyCSV = () => {
    const today = new Date().toLocaleDateString();
    const todaySales = sales.filter(s => toDate(s.timestamp).toLocaleDateString() === today);
    const exportData: Record<string, unknown>[] = todaySales.map(s => ({
      'Sale ID': s.id,
      'Date': toDate(s.timestamp).toLocaleString(),
      'Cashier': s.cashierName,
      'Customer': s.customerName || 'N/A',
      'Original Amount': s.totalAmount,
      'Refunded Amount': s.refundAmount || 0,
      'Net Amount': s.totalAmount - (s.refundAmount || 0),
      'Payment Method': s.paymentMethod,
      'Reference': s.reference || '',
      'Status': s.isCredit ? 'Credit' : 'Paid'
    }));

    // Add Totals
    const totalOriginal = todaySales.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalRefunded = todaySales.reduce((sum, s) => sum + (s.refundAmount || 0), 0);
    const totalNet = totalOriginal - totalRefunded;

    exportData.push({
      'Sale ID': 'TOTAL',
      'Date': '',
      'Cashier': '',
      'Customer': '',
      'Original Amount': totalOriginal,
      'Refunded Amount': totalRefunded,
      'Net Amount': totalNet,
      'Payment Method': '',
      'Reference': '',
      'Status': ''
    });

    downloadCSV(
      exportData, 
      `Daily_Sales_${new Date().toISOString().split('T')[0]}.csv`,
      "Daily Sales Report"
    );
  };

  const exportInventoryCSV = () => {
    const exportData: Record<string, unknown>[] = products.map(p => ({
      'SKU': p.sku,
      'Barcode': p.barcode,
      'Product Name': p.name,
      'Buying Price': p.buyingPrice,
      'Selling Price': p.sellingPrice,
      'Stock Quantity': p.stockQuantity,
      'Unit': p.unitType,
      'Total Value (Cost)': p.stockQuantity * p.buyingPrice,
      'Total Value (Retail)': p.stockQuantity * p.sellingPrice
    }));

    // Add Totals
    const totalQty = products.reduce((sum, p) => sum + p.stockQuantity, 0);
    const totalCostValue = products.reduce((sum, p) => sum + (p.stockQuantity * p.buyingPrice), 0);
    const totalRetailValue = products.reduce((sum, p) => sum + (p.stockQuantity * p.sellingPrice), 0);

    exportData.push({
      'SKU': 'TOTAL',
      'Barcode': '',
      'Product Name': '',
      'Buying Price': '',
      'Selling Price': '',
      'Stock Quantity': totalQty,
      'Unit': '',
      'Total Value (Cost)': totalCostValue,
      'Total Value (Retail)': totalRetailValue
    });

    downloadCSV(
      exportData, 
      `Inventory_Report_${new Date().toISOString().split('T')[0]}.csv`,
      "Inventory Status Report"
    );
  };

  const exportProfitCSV = async () => {
    const toastId = toast.loading("Preparing profit report... This may take a moment.");
    try {
      const { filteredSales } = getFilteredData(activePeriod);
      const saleIds = new Set(filteredSales.map(s => s.id));
      const profitRows: Record<string, unknown>[] = [];
      
      // Use collection group query for much better performance (one query instead of N)
      const itemsSnapshot = await getDocs(query(collectionGroup(db, 'items')));
      
      const itemsBySale = new Map<string, any[]>();
      itemsSnapshot.docs.forEach(doc => {
        const saleId = doc.ref.parent.parent?.id;
        if (saleId && saleIds.has(saleId)) {
          const data = doc.data();
          if (!itemsBySale.has(saleId)) itemsBySale.set(saleId, []);
          itemsBySale.get(saleId)?.push(data);
        }
      });

      for (const sale of filteredSales) {
        const items = itemsBySale.get(sale.id) || [];
        for (const item of items) {
          if (item.status === 'refunded') continue;
          const product = products.find(p => p.id === item.productId);
          const buyingPrice = product?.buyingPrice || 0;
          const profit = item.totalPrice - (buyingPrice * item.quantity);
          profitRows.push({
            'Date': toDate(sale.timestamp).toLocaleString(),
            'Sale ID': sale.id,
            'Product': item.productName,
            'Quantity': item.quantity,
            'Buying Price': buyingPrice,
            'Selling Price': item.unitPrice,
            'Total Cost': buyingPrice * item.quantity,
            'Total Revenue': item.totalPrice,
            'Profit': profit
          });
        }
      }

      // Add Totals
      const totalQty = profitRows.reduce((sum, r) => sum + Number(r['Quantity'] ?? 0), 0);
      const totalCost = profitRows.reduce((sum, r) => sum + Number(r['Total Cost'] ?? 0), 0);
      const totalRevenue = profitRows.reduce((sum, r) => sum + Number(r['Total Revenue'] ?? 0), 0);
      const totalProfit = profitRows.reduce((sum, r) => sum + Number(r['Profit'] ?? 0), 0);

      profitRows.push({
        'Date': 'TOTAL',
        'Sale ID': '',
        'Product': '',
        'Quantity': totalQty,
        'Buying Price': '',
        'Selling Price': '',
        'Total Cost': totalCost,
        'Total Revenue': totalRevenue,
        'Profit': totalProfit
      });

      downloadCSV(
        profitRows, 
        `Profit_Report_${activePeriod}_${new Date().toISOString().split('T')[0]}.csv`,
        `Profit Report (${activePeriod.toUpperCase()})`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'sales_items');
    } finally {
      toast.dismiss(toastId);
    }
  };

  const exportProfitSummaryCSV = () => {
    const stats = calculateProfitEstimate(activePeriod);

    const data = [
      {
        'Report Period': activePeriod.toUpperCase(),
        'Revenue': stats.revenue,
        'Estimated Cost': stats.estimated_cost,
        'Estimated Profit': stats.estimated_profit,
        'Date Range': activePeriod === 'daily' ? 'Today' : activePeriod === 'weekly' ? 'Last 7 Days' : 'Current Month'
      }
    ];

    downloadCSV(
      data, 
      `Profit_Summary_${activePeriod}_${new Date().toISOString().split('T')[0]}.csv`,
      `Profit Summary Report (${activePeriod.toUpperCase()})`
    );
  };
  
  const exportExpensesCSV = () => {
    const exportData: Record<string, unknown>[] = expenses.map(e => ({
      'ID': e.id,
      'Date': typeof e.date === 'string' ? e.date : (e.date && typeof e.date === 'object' && 'toDate' in e.date ? (e.date as any).toDate().toLocaleString() : e.date instanceof Date ? e.date.toLocaleString() : ''),
      'Category': e.category,
      'Description': e.description,
      'Amount': e.amount,
      'Payment Method': e.paymentMethod,
      'Reference': e.reference || 'N/A',
      'Recorded By': e.recordedByName
    }));

    // Add Totals
    const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
    exportData.push({
      'ID': 'TOTAL',
      'Date': '',
      'Category': '',
      'Description': '',
      'Amount': totalAmount,
      'Payment Method': '',
      'Reference': '',
      'Recorded By': ''
    });

    downloadCSV(
      exportData, 
      `Expenses_Report_${new Date().toISOString().split('T')[0]}.csv`,
      "Expenses Report"
    );
  };

  const paymentData = [
    { name: 'Cash', value: sales.filter(s => s.paymentMethod === 'cash').length },
    { name: 'M-Pesa', value: sales.filter(s => s.paymentMethod === 'mpesa').length },
    { name: 'Card', value: sales.filter(s => s.paymentMethod === 'card').length },
  ].filter(d => d.value > 0);

  const COLORS = ['#4f46e5', '#10b981', '#f59e0b'];

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Reports</h1>
          <p className="text-gray-500">Analyze sales trends, export records, and review profitability.</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50">
            <Calendar className="w-4 h-4" />
            Last 30 Days
          </button>
          <button 
            onClick={() => {
              const exportData: Record<string, unknown>[] = sales.map(s => ({
                ID: s.id,
                Date: s.timestamp ? (typeof s.timestamp === 'string' ? s.timestamp : toDate(s.timestamp).toLocaleString()) : '',
                'Original Amount': s.totalAmount,
                'Refunded Amount': s.refundAmount || 0,
                'Net Amount': s.totalAmount - (s.refundAmount || 0),
                Method: s.paymentMethod,
                Cashier: s.cashierName
              }));
              const totalOriginal = sales.reduce((sum, s) => sum + s.totalAmount, 0);
              const totalRefunded = sales.reduce((sum, s) => sum + (s.refundAmount || 0), 0);
              const totalNet = totalOriginal - totalRefunded;
              
              exportData.push({
                ID: 'TOTAL',
                Date: '',
                'Original Amount': totalOriginal,
                'Refunded Amount': totalRefunded,
                'Net Amount': totalNet,
                Method: '',
                Cashier: ''
              });
              downloadCSV(exportData, 'All_Sales.csv', "All Sales History Report");
            }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 shadow-lg shadow-indigo-100"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500 font-medium">Total Revenue</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">KES {totalRevenue.toLocaleString()}</p>
          <div className="mt-2 flex items-center text-green-600 text-sm font-medium">
            <span>+12.5% from last month</span>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500 font-medium">Total Transactions</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{sales.length}</p>
          <div className="mt-2 flex items-center text-blue-600 text-sm font-medium">
            <span>{sales.length > 0 ? 'Active' : 'No activity'}</span>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500 font-medium">Average Sale</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">KES {avgSale.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          <div className="mt-2 flex items-center text-indigo-600 text-sm font-medium">
            <span>Per customer</span>
          </div>
        </div>
      </div>

      {/* New Extended Capabilities Section */}
      <div className="bg-white rounded-4xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-8 border-b border-gray-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Advanced Reports</h2>
            <p className="text-sm text-gray-500">Choose a period and export clean CSV files</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button 
              onClick={() => setActivePeriod('daily')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activePeriod === 'daily' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}
            >
              Daily Sales
            </button>
            <button 
              onClick={() => setActivePeriod('weekly')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activePeriod === 'weekly' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}
            >
              Weekly Sales
            </button>
            <button 
              onClick={() => setActivePeriod('monthly')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activePeriod === 'monthly' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}
            >
              Monthly Sales
            </button>
          </div>
        </div>
        
        <div className="p-8">
          <div className="flex flex-wrap gap-4 mb-8">
            <button 
              onClick={exportDailyCSV}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
            >
              <Download className="w-4 h-4" />
              Export Daily CSV
            </button>
            <button 
              onClick={exportInventoryCSV}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
            >
              <Package className="w-4 h-4" />
              Export Inventory CSV
            </button>
            <button 
              onClick={exportExpensesCSV}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
            >
              <FileText className="w-4 h-4" />
              Export Expenses CSV
            </button>
            {user?.role === 'superadmin' && (
              <button 
                onClick={exportProfitCSV}
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
              >
                <DollarSign className="w-4 h-4" />
                Export Profit CSV
              </button>
            )}
            {user?.role === 'superadmin' && (
              <button 
                onClick={exportProfitSummaryCSV}
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
              >
                <TrendingUp className="w-4 h-4" />
                Export Profit Summary CSV
              </button>
            )}
          </div>

          {user?.role === 'superadmin' && (
            <div className="bg-gray-50 rounded-3xl border border-gray-100 p-8 font-mono text-sm text-gray-800 mt-8">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Profit Estimate</h4>
              <pre className="whitespace-pre-wrap">
                {JSON.stringify(profitStats, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Debt Aging & Low Stock Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-8 rounded-4xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-red-50 text-red-600 rounded-2xl">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900">Debt Aging</h3>
                <p className="text-xs text-gray-500 font-medium">Outstanding balances by age</p>
              </div>
            </div>
          </div>
          <div className="h-75 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={debtAgingData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: '#9ca3af' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: '#9ca3af' }} />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  cursor={{ fill: '#f9fafb' }}
                />
                <Bar dataKey="value" fill="#4f46e5" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-4xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900">Low Stock Alert</h3>
                <p className="text-xs text-gray-500 font-medium">{lowStockProducts.length} items need restocking</p>
              </div>
            </div>
            <button 
              onClick={exportInventoryCSV}
              className="p-2 hover:bg-gray-50 rounded-xl text-gray-400 transition-colors"
            >
              <Download className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-4 max-h-75 overflow-y-auto pr-2 custom-scrollbar">
            {lowStockProducts.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm text-gray-400 font-medium">All stock levels are healthy</p>
              </div>
            ) : lowStockProducts.map(p => (
              <div key={p.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 group hover:border-amber-200 transition-all">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-bold text-gray-400 text-xs shadow-sm group-hover:scale-110 transition-transform">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{p.name}</p>
                    <p className="text-[10px] text-gray-500 font-medium">SKU: {p.sku}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-red-600">{p.stockQuantity} {p.unitType}</p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Alert at {p.lowStockThreshold || 5}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 min-w-0 min-h-0">
          <h3 className="font-bold text-gray-900 mb-6">Payment Methods</h3>
          <div className="h-75 w-full">
            {paymentData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <PieChart>
                  <Pie
                    data={paymentData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {paymentData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-gray-400">No data available</p>
            )}
          </div>
          <div className="flex justify-center gap-6 mt-4">
            {paymentData.map((d, i) => (
              <div key={d.name} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                <span className="text-sm text-gray-600">{d.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-900 mb-6">Recent Sales History</h3>
          <div className="overflow-x-auto max-h-100 overflow-y-auto pr-2 custom-scrollbar">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-white z-10 shadow-sm text-xs text-gray-600 uppercase">
                <tr className="bg-gray-50/50">
                  <th className="pb-4">ID</th>
                  <th className="pb-4">Cashier</th>
                  <th className="pb-4">Amount</th>
                  <th className="pb-4">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sales.slice(0, 8).map(sale => (
                  <tr key={sale.id} className="text-sm">
                    <td className="py-3 font-mono text-xs text-gray-500">#{sale.id.slice(-6)}</td>
                    <td className="py-3 font-medium">{sale.cashierName}</td>
                    <td className="py-3 font-bold">
                      <div className="flex flex-col">
                        <span>KES {(sale.totalAmount - (sale.refundAmount || 0)).toLocaleString()}</span>
                        {sale.refundAmount > 0 && (
                          <span className="text-[10px] text-red-500 line-through">KES {sale.totalAmount.toLocaleString()}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3">
                      <span className="px-2 py-1 bg-gray-100 rounded text-[10px] font-bold uppercase">
                        {sale.paymentMethod}
                      </span>
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
